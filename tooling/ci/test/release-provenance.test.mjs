// ─────────────────────────────────────────────────────────────────────────────
// release-provenance.test.mjs — assert-release-provenance.mjs must be able to FAIL.
//
// [pipeline R-6] no release build from an ungated commit; no publish without a
// record of what shipped.
//
// ⚠️ SECOND LINE OF EVIDENCE. 10 mutations ran against the REAL tree first, with
// a harness that re-asserts a green baseline after every restore and ABORTS if
// it cannot. TWO of them came back MISSED and BOTH were the mutation's fault,
// not the guard's — I had blanked `--release` in one workflow while another
// still had it, so the COVERAGE LOST condition was never actually created.
// Re-run correctly, both fired. **A MISSED result needs diagnosis, not
// acceptance**: the first reading would have had me "fix" a guard that was right.
//
// The guard's own first run against the real tree produced 11 failures, of which
// FIVE were its own bugs, and checking them beat trusting them:
//   · `npx wrangler deploy --dry-run` (ci.yml ×3) is not a publish. Demanding a
//     marker there would have written three deployments that never happened into
//     [10]D-9's ledger.
//   · `needs: detect` — the SCALAR form — was unparsed, so deploy-workers.yml's
//     correctly-gated production deploys looked ungated. "Fixing" the tree on
//     that reading would have been the actual defect.
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
const GUARD = join(CI_DIR, 'assert-release-provenance.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-prov-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const GATE_STEP = '      - run: node tooling/ci/assert-gate-passed.mjs ${{ github.sha }}';
const MARKER_STEP = '      - run: node tooling/ci/record-deployment.mjs app-web https://x';
const BUILD_STEP = '      - run: flutter build web --release';
const DEPLOY_STEP = '      - run: npx wrangler pages deploy build/web';

/**
 * A build workflow whose gate lives in a separate job. `needsForm` exercises all
 * three YAML spellings — the scalar one is the shape deploy-workers.yml uses and
 * the one the first version could not read.
 */
function buildWorkflow({ gateJob = true, needsForm = 'scalar', gateInBuildJob = null, buildIf = null, gateCoe = false } = {}) {
  // The quoted spellings joined the map for the 2026-07-31 triage: every one is
  // YAML GitHub runs, and the unquoted-only parser turned `needs: ["gate"]`
  // into a false red on a correctly-gated workflow.
  const NEEDS = {
    none: '',
    scalar: '    needs: gate\n',
    'scalar-quoted': "    needs: 'gate'\n",
    flow: '    needs: [gate]\n',
    'flow-quoted': '    needs: ["gate"]\n',
    block: '    needs:\n      - gate\n',
    'block-quoted': '    needs:\n      - "gate"\n',
    bogus: '    needs: [nope]\n',
  };
  const needs = NEEDS[needsForm];
  const gateSteps = gateCoe ? `${GATE_STEP}\n        continue-on-error: true` : GATE_STEP;
  const gate = gateJob ? `  gate:\n    runs-on: ubuntu-24.04\n    steps:\n${gateSteps}\n\n` : '';
  const ifLine = buildIf === null ? '' : `    if: ${buildIf}\n`;
  const inJob =
    gateInBuildJob === 'before' ? `${GATE_STEP}\n${BUILD_STEP}\n` : gateInBuildJob === 'after' ? `${BUILD_STEP}\n${GATE_STEP}\n` : BUILD_STEP + '\n';
  return `name: Build\non:\n  workflow_dispatch:\njobs:\n${gate}  build:\n    runs-on: ubuntu-24.04\n${ifLine}${needs}    steps:\n${inJob}`;
}

// ── limb 4's fixture (2026-08-21) ────────────────────────────────────────────
// A submit lane joins the BASE tree rather than only the new cases, because
// limb 4 carries a domain floor and a tree with no `--submit` job anywhere is
// COVERAGE LOST — correctly. Adding it here is what keeps the 39 pre-existing
// cases testing what they were written to test. It is deliberately the SHAPE of
// the real lanes and not a copy of them: `submit-store.mjs` is a name no real
// script has, so nothing here can pass by resembling submit-play.mjs.
const SUBMIT_STEP = '      - run: node tooling/release/submit-store.mjs --submit --app subly';

/** The run-time half limb 4 (b) demands, as real code. The template literal
 *  carrying `//` in a URL is on purpose: it is the shape that breaks a stripper
 *  that is not string-aware, and submit-play.mjs:453 is written exactly so. */
const SUBMIT_SCRIPT_REAL =
  'const envUrl = `https://api.github.com/repos/${repo}/environments/store-publish`;\n' +
  'const rules = Array.isArray(envJson.protection_rules) ? envJson.protection_rules : [];\n';

/** The same words, in a COMMENT. The whole point of routing the script through
 *  stripSourceComments: this must NOT earn the credit. */
const SUBMIT_SCRIPT_COMMENT_ONLY =
  '// this script GETs /environments/store-publish and checks protection_rules\n' +
  '/* it really does read protection_rules from /environments/ */\nconst x = 1;\n';

/** Neither half — a submit script that never looks at the environment at all. */
const SUBMIT_SCRIPT_BLIND = 'const x = 1;\nconsole.log("uploading");\n';

/** The OTHER half-read, added 2026-08-21: `protection_rules` present, no
 *  `/environments/` anywhere. BRANCH protection, not DEPLOYMENT-environment
 *  protection — a different object on a different endpoint, and reading it says
 *  nothing about whether the store upload pauses for a human. This is the shape
 *  that made dropping the ENV_API_READ conjunct survivable; see the sweep
 *  correction above the suite. */
const SUBMIT_SCRIPT_WRONG_ENDPOINT =
  'const res = await fetch(`https://api.github.com/repos/${repo}/branches/main/protection`);\n' +
  'const rules = Array.isArray((await res.json()).protection_rules) ? 1 : 0;\n';

/** A SECOND job in the SAME FILE that does carry a job-level `environment:`.
 *  Nothing in it builds, publishes or submits, so limbs 1-3 never see it — its
 *  only job is to be somewhere else in the file for a file-scoped read to find.
 *  This is the shape every real submit lane grows: submit-play.yml already has a
 *  `build` job beside its `submit` job. */
const OTHER_JOB_WITH_ENVIRONMENT =
  '  prep:\n    runs-on: ubuntu-24.04\n    environment: store-publish\n    steps:\n      - run: echo prep\n';

/** A STEP-level `environment:` — an INPUT to an action, nested under `with:` at
 *  ten spaces. Legal, common, and not a deployment environment at all: it makes
 *  GitHub pause for nobody. The ` {4}` anchor is the only thing telling them
 *  apart. */
const STEP_LEVEL_ENVIRONMENT = '      - uses: example/set-env@v1\n        with:\n          environment: production\n';

function submitWorkflow({ environment = 'store-publish', step = SUBMIT_STEP, otherJob = '', stepsBefore = '' } = {}) {
  // Block form as well as scalar: `environment:\n      name: …` is legal YAML
  // GitHub honours, and a check anchored to the scalar spelling would false-red
  // a correctly-gated lane — the scalar-`needs:` lesson one key over.
  //
  // 🔴 THE `'block'` ARM IS A GREEN THAT IS DECLARED, NOT AN UNPINNED ONE —
  // sweep 2026-08-24. Switched off, the arm falls through to the scalar spelling
  // and every case still passes, and NO case can be written that would notice:
  // the guard's anchor is `/^ {4}environment:/`, which matches the block form's
  // opening line and the scalar line alike, by construction and on purpose (the
  // guard's own constants block records probing that the bare key satisfies (a)).
  // So this arm can only ever produce a line the anchor already accepts — no
  // verdict can differ. It stays because a reader has to be able to see that the
  // block spelling was tried; the condition the anchor DOES carry is held four
  // ways: `^`, ` {4}`, `environment`, and the trailing `:`, each with its case.
  const env =
    environment === null
      ? ''
      : environment === 'block'
        ? '    environment:\n      name: store-publish\n'
        : `    environment: ${environment}\n`;
  return `name: Submit\non:\n  workflow_dispatch:\njobs:\n${otherJob}  submit:\n    runs-on: ubuntu-24.04\n${env}    steps:\n${stepsBefore}${step}\n`;
}

function deployWorkflow({ gate = true, marker = true, markerBeforeDeploy = false, dryRun = false } = {}) {
  const deploy = dryRun ? '      - run: npx wrangler deploy --dry-run' : DEPLOY_STEP;
  const steps = markerBeforeDeploy ? [gate ? GATE_STEP : null, MARKER_STEP, deploy] : [gate ? GATE_STEP : null, deploy, marker ? MARKER_STEP : null];
  return `name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-24.04\n    steps:\n${steps.filter(Boolean).join('\n')}\n`;
}

function tree({
  build = buildWorkflow(),
  deploy = deployWorkflow(),
  servedLane = '.github/workflows/deploy.yml',
  omitGateScript = false,
  omitMarkerScript = false,
  submit = submitWorkflow(),
  submitScript = SUBMIT_SCRIPT_REAL,
  // ADDED 2026-08-24 to pin limb 4 (b)'s LOOP BOUND. Every other two-call
  // fixture in this file points both `--submit` calls at the SAME script, so
  // the first call's verdict is the second call's verdict and truncating the
  // loop changes nothing. `extraScript` writes a SECOND script somewhere else
  // in the tree so the two calls can disagree. `{ path, body }`, path relative
  // to the tree root.
  extraScript = null,
  // ADDED 2026-08-22 by the exhaustive `if (false)` sweep — see the block at the
  // foot of this file. Three floors sit ABOVE the job parse and no case could
  // reach them, because every tree this helper built had a populated
  // `.github/workflows` and a gate script that declared `GATE`.
  // `workflowDir: 'absent'` never creates the directory; `'empty'` creates it
  // and writes nothing into it; `gateScriptBody` takes the GATE name away
  // without deleting the file (which is already a different floor).
  workflowDir = 'files',
  gateScriptBody = "const GATE = 'ci-gate'; // stub\n",
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  if (workflowDir === 'files') {
    write('.github/workflows/build.yml', build);
    write('.github/workflows/deploy.yml', deploy);
    // `submit === null` is how a case removes the submit lane entirely, which is
    // limb 4's COVERAGE LOST floor and not a quiet pass.
    if (submit !== null) write('.github/workflows/submit.yml', submit);
  } else if (workflowDir === 'empty') {
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
  }
  if (submitScript !== null) write('tooling/release/submit-store.mjs', submitScript);
  if (extraScript !== null) write(extraScript.path, extraScript.body);
  // The stub carries the real script's `GATE` declaration on purpose: the
  // guard DERIVES the gate check name from assert-gate-passed.mjs (single
  // declaration, [pipeline F-2]) and goes COVERAGE LOST when it cannot.
  if (!omitGateScript) write('tooling/ci/assert-gate-passed.mjs', gateScriptBody);
  if (!omitMarkerScript) write('tooling/ci/record-deployment.mjs', '// stub\n');
  write(
    'tooling/channel-register.json',
    JSON.stringify({ channels: [{ id: 'web', served: true, lane: { workflow: servedLane, job: 'deploy' } }] }, null, 2),
  );
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-release-provenance — a release build must be gated first', () => {
  test('PASSES a gated build and a gated, recorded deploy', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /assert-release-provenance: ok/);
  });

  test('FAILS when the build job does not reach the gate job', () => {
    const { code, out } = run(tree({ build: buildWorkflow({ needsForm: 'none' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /neither it nor any job it `needs` calls/);
  });

  test('FAILS when there is no gate job at all', () => {
    const { code, out } = run(tree({ build: buildWorkflow({ gateJob: false, needsForm: 'none' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /neither it nor any job it `needs` calls/);
  });

  test('FAILS when the gate runs AFTER the build in the same job', () => {
    const { code, out } = run(tree({ build: buildWorkflow({ gateJob: false, needsForm: 'none', gateInBuildJob: 'after' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /AFTER its first release build/);
  });

  test('PASSES when the gate runs BEFORE the build in the same job', () => {
    const { code, out } = run(tree({ build: buildWorkflow({ gateJob: false, needsForm: 'none', gateInBuildJob: 'before' }) }));
    assert.equal(code, 0, out);
  });

  // All three YAML spellings of `needs:`. The scalar form is the one the first
  // version could not read, which made a correctly-gated workflow look broken.
  for (const form of ['scalar', 'flow', 'block']) {
    test(`resolves the needs graph in ${form} form`, () => {
      const { code, out } = run(tree({ build: buildWorkflow({ needsForm: form }) }));
      assert.equal(code, 0, out);
    });
  }

  test('does NOT accept a gate call that only appears in a comment', () => {
    const commented = buildWorkflow({ gateJob: false, needsForm: 'none' }).replace(
      '    steps:',
      '    steps:\n      # we run node tooling/ci/assert-gate-passed.mjs here, honestly',
    );
    const { code, out } = run(tree({ build: commented }));
    assert.equal(code, 1, out);
    assert.match(out, /neither it nor any job it `needs` calls/);
  });
});

describe('assert-release-provenance — a publish must record what shipped', () => {
  test('FAILS when a deploy never calls record-deployment', () => {
    const { code, out } = run(tree({ deploy: deployWorkflow({ marker: false }) }));
    assert.equal(code, 1, out);
    assert.match(out, /never calls tooling\/ci\/record-deployment\.mjs/);
  });

  test('FAILS when the marker is written BEFORE the deploy', () => {
    const { code, out } = run(tree({ deploy: deployWorkflow({ markerBeforeDeploy: true }) }));
    assert.equal(code, 1, out);
    assert.match(out, /records the deployment at :\d+, BEFORE its last publish/);
  });

  test('FAILS when a deploy is not gated', () => {
    const { code, out } = run(tree({ deploy: deployWorkflow({ gate: false }) }));
    assert.equal(code, 1, out);
    assert.match(out, /without any `tooling\/ci\/assert-gate-passed\.mjs` call/);
  });

  // Review 2026-07-31 (mutation-proven): limb 2 checked only that a gate call
  // EXISTED — a same-job gate placed after the publish passed, and publish-only
  // jobs are exactly the ones limb 1's ordering never sees.
  test('FAILS when a publish-only job gates AFTER publishing', () => {
    const gateAfter = `name: Ship\non:\n  push:\njobs:\n  deploy:\n    runs-on: ubuntu-24.04\n    steps:\n${DEPLOY_STEP}\n${GATE_STEP}\n${MARKER_STEP}\n`;
    const { code, out } = run(tree({ deploy: gateAfter }));
    assert.equal(code, 1, out);
    assert.match(out, /AFTER its first publish/);
  });

  // Review 2026-07-31: `gh release upload` is the register's own locked
  // AppImage flow (Releases as artifact origin) and the PUBLISH list missed it.
  test('gh release upload IS a publish and needs a gate + marker', () => {
    const uploader = `name: Ship\non:\n  push:\njobs:\n  upload:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: gh release upload subly-v1 app.AppImage\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/upload.yml'), uploader);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /upload\.yml/);
    assert.match(out, /GitHub Release publish/);
  });

  // The false-positive that cost the first version three failures on ci.yml.
  test('a --dry-run is NOT a publish and needs no marker', () => {
    // Deploy workflow is dry-run only; the build workflow keeps the domain non-empty.
    const dryOnly = `name: Typecheck\non:\n  push:\njobs:\n  check:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npx wrangler deploy --dry-run\n`;
    const withRealDeploy = deployWorkflow();
    const root = tree({ deploy: withRealDeploy });
    writeFileSync(join(root, '.github/workflows/typecheck.yml'), dryOnly);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /typecheck\.yml/);
  });

  test('but the SAME line without --dry-run IS a publish', () => {
    const realDeploy = `name: Typecheck\non:\n  push:\njobs:\n  check:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npx wrangler deploy\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/typecheck.yml'), realDeploy);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /typecheck\.yml/);
  });

  test('actions/upload-artifact is NOT a publish — it is a 7-day build proof', () => {
    const withUpload = buildWorkflow().replace(
      BUILD_STEP,
      `${BUILD_STEP}\n      - uses: actions/upload-artifact@v4\n        with:\n          retention-days: 7`,
    );
    const { code, out } = run(tree({ build: withUpload }));
    assert.equal(code, 0, out);
  });
});

describe('assert-release-provenance — coverage self-checks', () => {
  test('FAILS COVERAGE LOST when assert-gate-passed.mjs is gone from disk', () => {
    const { code, out } = run(tree({ omitGateScript: true }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /assert-gate-passed\.mjs does not exist/);
  });

  test('FAILS COVERAGE LOST when record-deployment.mjs is gone from disk', () => {
    const { code, out } = run(tree({ omitMarkerScript: true }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('FAILS COVERAGE LOST when no job builds --release anywhere', () => {
    const noRelease = buildWorkflow().replace('--release', '--profile');
    const noReleaseDeploy = deployWorkflow();
    const { code, out } = run(tree({ build: noRelease, deploy: noReleaseDeploy }));
    assert.equal(code, 1, out);
    assert.match(out, /ZERO jobs .* run a `flutter build` in release mode/);
  });

  test('FAILS COVERAGE LOST when no publish step exists anywhere', () => {
    const noPublish = deployWorkflow().replace(DEPLOY_STEP, '      - run: echo nothing');
    const { code, out } = run(tree({ deploy: noPublish }));
    assert.equal(code, 1, out);
    assert.match(out, /ZERO publishing jobs/);
  });

  test('FAILS when the register declares no served lane — limb 3 loses its subject', () => {
    const root = tree();
    writeFileSync(join(root, 'tooling/channel-register.json'), JSON.stringify({ channels: [] }));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /declares no SERVED channel with a lane/);
  });

  test('FAILS when a SERVED lane workflow has no gate anywhere in it', () => {
    // A served lane whose workflow neither builds --release nor publishes still
    // must be gated — otherwise a served channel ships from an unverified commit.
    const inert = `name: Ship\non:\n  push:\njobs:\n  deploy:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ship it\n`;
    const root = tree({ deploy: deployWorkflow(), servedLane: '.github/workflows/inert.yml' });
    writeFileSync(join(root, '.github/workflows/inert.yml'), inert);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /is the lane for a SERVED channel/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Triage 2026-07-31 — five mutation-proven detection defects, each pinned below.
// Every one was first proven against a copy of the REAL tree (harness verified
// its own restores) before these fixtures were written.

describe('assert-release-provenance — release is the DEFAULT build mode (triage 2026-07-31)', () => {
  test('an ungated `flutter build appbundle` with no --release flag FAILS', () => {
    // Release is Flutter's default; the flag is decoration. The old regex made
    // the very next Play lane anyone writes an invisible release build.
    const aab = `name: M1\non:\n  workflow_dispatch:\njobs:\n  build_aab:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: flutter build appbundle\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/aab.yml'), aab);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /aab\.yml: job "build_aab" runs 1 release build\(s\)/);
    assert.match(out, /neither it nor any job it `needs` calls/);
  });

  test('`flutter build apk --debug` is NOT a release build', () => {
    const dbg = `name: Dbg\non:\n  workflow_dispatch:\njobs:\n  build_dbg:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: flutter build apk --debug\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/dbg.yml'), dbg);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /dbg\.yml/);
  });

  test('a folded `run: >` build with --release on a continuation line IS seen', () => {
    // deploy-web.yml folds its real build exactly this way; the line-anchored
    // regex saw `flutter build web` and `--release` on different lines and
    // matched neither.
    const folded = `name: F\non:\n  workflow_dispatch:\njobs:\n  folded:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: >\n          flutter build web\n          --release --pwa-strategy=none\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/folded.yml'), folded);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /folded\.yml: job "folded"/);
  });

  test('a bare `flutter build` inside the gate workflow itself is gated by construction', () => {
    // ci.yml's stamped-probe build: a job the ci-gate verdict `needs` cannot go
    // red without the gate going red, and the gate cannot poll itself for the
    // verdict it is busy producing.
    const gateWf = `name: CI\non:\n  push:\njobs:\n  probe:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: flutter build web --pwa-strategy=none\n  verdict:\n    name: ci-gate\n    runs-on: ubuntu-24.04\n    needs: [probe]\n    if: always()\n    steps:\n      - run: echo aggregate\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/gatewf.yml'), gateWf);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /gatewf\.yml/);
  });
});

describe('assert-release-provenance — dry-run exclusion is per command SEGMENT', () => {
  // The lone-dry-run green case (the five-false-failures lesson) is pinned
  // above ('a --dry-run is NOT a publish'); this is the other half: the same
  // token must not exonerate a real deploy chained after it.
  test('`wrangler deploy --dry-run && wrangler deploy` IS a publish', () => {
    const chain = `name: C\non:\n  workflow_dispatch:\njobs:\n  validate_then_ship:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npx wrangler deploy --dry-run && npx wrangler deploy\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/chain.yml'), chain);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /chain\.yml: job "validate_then_ship" performs a Cloudflare deploy at :\d+ and never calls/);
    assert.match(out, /chain\.yml: job "validate_then_ship" performs a Cloudflare deploy without any/);
  });
});

describe('assert-release-provenance — wrangler-action is classified from its command:', () => {
  const action = (cmd, { gated = false } = {}) => {
    const gate = gated ? `${GATE_STEP}\n` : '';
    const withCmd = cmd === null ? '' : `          command: ${cmd}\n`;
    return `name: W\non:\n  workflow_dispatch:\njobs:\n  worker:\n    runs-on: ubuntu-24.04\n    steps:\n${gate}      - uses: cloudflare/wrangler-action@abc\n        with:\n          apiToken: x\n${withCmd}`;
  };

  test('a gated `command: deploy --dry-run` is NOT a publish — no marker demanded', () => {
    // The false fail that pressured a fabricated ledger entry: classification
    // from the `uses:` line could never see the verb.
    const root = tree();
    writeFileSync(join(root, '.github/workflows/action.yml'), action('deploy --dry-run', { gated: true }));
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /action\.yml/);
  });

  test('the dry-run exclusion inside a `command:` is per SEGMENT too', () => {
    // ADDED 2026-08-24. Pins `shellSegments(cmd)` in the ACTION pass. The generic
    // pass has its own per-segment case ('`wrangler deploy --dry-run && wrangler
    // deploy` IS a publish'); the SYNTHESIZED `wrangler <command:>` had none, so
    // the split could be replaced by `[cmd]` with every case still green — and a
    // `command:` whose first word is a dry run would then hide a real deploy
    // standing beside it. That is the 2026-07-31 over-rotation this repo has
    // already paid for once on plain `run:` lines, reappearing one classifier
    // over.
    const root = tree();
    writeFileSync(join(root, '.github/workflows/action.yml'), action('deploy --dry-run && wrangler deploy'));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /action\.yml: job "worker" performs a Cloudflare deploy action/);
  });

  test('`command: d1 migrations apply` is NOT a publish', () => {
    const root = tree();
    writeFileSync(join(root, '.github/workflows/action.yml'), action('d1 migrations apply APP_DB --remote', { gated: true }));
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /action\.yml/);
  });

  test('an ungated `command: deploy` still FAILS both limbs', () => {
    const root = tree();
    writeFileSync(join(root, '.github/workflows/action.yml'), action('deploy'));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /action\.yml: job "worker" performs a Cloudflare deploy action at :\d+ and never calls/);
    assert.match(out, /action\.yml: job "worker" performs a Cloudflare deploy action without any/);
  });

  test('no `command:` key at all is the action DEFAULT — deploy — and counts', () => {
    const root = tree();
    writeFileSync(join(root, '.github/workflows/action.yml'), action(null));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /action\.yml: job "worker" performs a Cloudflare deploy action/);
  });

  test('a `command:` naming the action ITSELF is a publish at its own line — the deleted `!p.viaCommand` conjunct is held', () => {
    // ADDED 2026-08-24. The 2026-08-22 deletion of `!p.viaCommand &&` from the
    // action pass shipped with a proof saying no fixture could distinguish the
    // two, "MEASURED on such a tree: identical output, conjunct or not". This is
    // that tree, and the outputs are not identical: the value
    // `cloudflare/wrangler-action` on the `command:` line is itself matched by
    // the viaCommand pattern, so WITHOUT the conjunct the first publish is that
    // line (:10) and the gate call below it (:11) is late; WITH the conjunct the
    // first publish moves down to the nested `command: deploy` (:13) and the run
    // goes green. Restoring the conjunct turns this case RED, which is the point
    // of writing it: the deletion is now held rather than argued.
    const nested =
      'name: W\n' + // 1
      'on:\n' + // 2
      '  workflow_dispatch:\n' + // 3
      'jobs:\n' + // 4
      '  worker:\n' + // 5
      '    runs-on: ubuntu-24.04\n' + // 6
      '    steps:\n' + // 7
      '      - uses: cloudflare/wrangler-action@abc\n' + // 8
      '        with:\n' + // 9
      '          command: cloudflare/wrangler-action\n' + // 10
      '          extraArgs: node tooling/ci/assert-gate-passed.mjs x\n' + // 11
      '          env:\n' + // 12
      '            command: deploy\n' + // 13
      `${MARKER_STEP}\n`; // 14
    const root = tree();
    writeFileSync(join(root, '.github/workflows/nested.yml'), nested);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /nested\.yml: job "worker" calls tooling\/ci\/assert-gate-passed\.mjs at :11, AFTER its first publish at :10/);
  });
});

describe('assert-release-provenance — a disarmed needs edge is not a gate', () => {
  test('FAILS when the gated build job carries `if: always()` — mutation A1', () => {
    const { code, out } = run(tree({ build: buildWorkflow({ buildIf: 'always()' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /is neutralized: job "build" has a job-level `if:` at :\d+ containing `always\(\)`\/`failure\(\)`/);
  });

  test('FAILS when the gate job swallows its own failure with continue-on-error — mutation A2', () => {
    const { code, out } = run(tree({ build: buildWorkflow({ gateCoe: true }) }));
    assert.equal(code, 1, out);
    assert.match(out, /gate job "gate" carries `continue-on-error: true` at :\d+/);
  });

  test('an ordinary job-level `if:` is NOT flagged', () => {
    // Only always()/failure() disarm a needs edge; a ref condition narrows when
    // the job runs, never whether a failed gate can be outrun.
    const { code, out } = run(tree({ build: buildWorkflow({ buildIf: "github.ref == 'refs/heads/main'" }) }));
    assert.equal(code, 0, out);
  });
});

describe('assert-release-provenance — quoted needs forms are the same edge', () => {
  for (const form of ['flow-quoted', 'scalar-quoted', 'block-quoted']) {
    test(`a correctly-gated workflow written as ${form} needs PASSES`, () => {
      const { code, out } = run(tree({ build: buildWorkflow({ needsForm: form }) }));
      assert.equal(code, 0, out);
    });
  }

  test('an unquoted bogus dep still FAILS — quote-stripping did not widen the graph', () => {
    const { code, out } = run(tree({ build: buildWorkflow({ needsForm: 'bogus' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /neither it nor any job it `needs` calls/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// limb 4 (2026-08-21) — a `--submit` verb is TWO mechanisms, and the YAML half
// fails open.
//
// EVERY CONDITION limb 4 ADDS WAS DISABLED ONE AT A TIME AND PINNED. Re-run
// 2026-08-21 after the last edit to either file, against a COPY of tooling/ci
// under a scratch directory (the repo tree was never mutated), with the full
// green baseline re-asserted before each mutation and the runner aborting if a
// restore did not return to green. Twelve mutations, ZERO survivors:
//   job.lines→wf.lines 1 red · ` {4}` anchor dropped 1 · SUBMIT_FLAG anchors
//   dropped 1 · SUBMIT_SCRIPT's `node` prefix dropped 1 · SUBMIT_RUNNER conjunct
//   dropped 1 · limb4(a) `if (false)` 3 · limb4(b) `if (false)` 3 · the
//   `--submit` domain floor `if (false)` 4 · the unnamed-script floor
//   `if (false)` 2 · `call.script === null` `if (false)` 1 · `src === null`
//   `if (false)` 1 · the whole limb's domain entry `if (false)` 46.
// The runner reports 54 tests in this FILE and 15 in THIS SUITE — two different
// numbers, both taken from `node --test` after the last edit. NEITHER is a count
// of `test(` declarations: `grep -c "^  test(" tooling/ci/test/release-provenance.test.mjs`
// prints 48, and coverage-manifest.json's row for this file reads 50, because
// assert-guard-coverage counts statically and the runner counts executions.
// FOUR numbers describe this one file and only two of them come from running it;
// which one a sentence means has to be said, every time.
// 🔴 THOSE FOUR NUMBERS ARE A DATED 2026-08-21 RECORD AND ARE NOT CURRENT — the
// runner reports 90 tests in this file after the 2026-08-24 pass. They are left
// unedited because renumbering a dated measurement falsifies it; read the count
// from `node --test`, never from this paragraph.
// 🔴 AND "Twelve mutations, ZERO survivors" DID NOT SURVIVE RE-MEASUREMENT. The
// twelve ranged over limb 4's `if`s and conjuncts and over exactly two matcher
// members (SUBMIT_FLAG's anchors as one unit, SUBMIT_SCRIPT's `node` prefix).
// Sweeping the members ONE AT A TIME on 2026-08-24 found four more that survive
// with the whole suite green — SUBMIT_FLAG's `^`, SUBMIT_RUNNER's `\b…\b`,
// SUBMIT_SCRIPT's trailing `\b`, and ENV_API_READ's slashes. All four are pinned
// at the foot of this suite; the full re-sweep is recorded below the limb-4
// cases.
// 🔴 AND "ALL FOUR ARE PINNED" HELD FOR TWO OF THEM. `\b…\b` is TWO boundaries
// and "the slashes" is TWO slashes; both were swept as pairs, and a pair only
// ever fails together. Re-swept 2026-08-24 with every member split out, each of
// those four members stayed green on its own with the whole suite passing. They
// have their own cases now — a left-attached `xnode`, a leading-slash-less
// `environments/`, and the environments LIST endpoint — and the record is at the
// foot of this file.
//
// ── CORRECTION 2026-08-21, same day, before merge ────────────────────────────
// The block above replaced a sentence whose number did not reproduce. What
// stood here, verbatim, was:
//   "Every case below was run against the guard WITHOUT the limb first:
//    all six came back green, which is what "the negative half discriminates"
//    has to mean here."
// Measured at the start of this session, before a line was added: the suite held
// NINE cases, not six — a count that had stopped reproducing. "Run without the
// limb" is also just one mutation — the domain-entry row above, which now
// reports its count from the runner. The `if (false)` sweep is the stronger form of the same
// claim and it is the one recorded.
//
// ── CORRECTION 2026-08-21, same day, before merge — THE SWEEP WAS NOT COMPLETE ─
// "Twelve mutations, ZERO survivors" above is true of the twelve it ran and was
// read as a claim about EVERY condition. It was not one: it never mutated either
// conjunct of `const reads = ENV_API_READ.test(code) && ENV_PROTECTION_READ.test(code)`.
// RE-RUN this session as EIGHTEEN mutations — same harness, against a fresh
// scratch COPY of tooling/ci (the repo tree was never mutated), green baseline
// re-asserted after every restore, aborting if a restore did not come back
// green, and each anchor required to match exactly once. ONE SURVIVED:
//     (b) `ENV_API_READ.test(code) &&` dropped — 54 pass / 0 fail / exit 0
//         (54, not 55: that sweep ran BEFORE the case below was written)
// The `&&` was held from one side only. `half the read is not the read …` below
// pins `/environments/` present with `protection_rules` absent; NOTHING pinned
// `protection_rules` present with `/environments/` absent — a script reading
// BRANCH protection, which has the words and none of the meaning. `and the OTHER
// half …` is that case, written from the surviving mutation. The OTHER SEVENTEEN
// mutations all went red, the five regex/scope refinements and the two floors
// among them. Re-run with the new case in place: EIGHTEEN mutations, ZERO
// survivors — and that re-run is the one this file ships on.
//
// FOUR NUMBERS DESCRIBE THIS ONE FILE AND ONLY TWO COME FROM RUNNING IT. All
// four re-taken after the last edit to either file:
//     `node --test` → 55 tests in this FILE, 16 cases in THIS SUITE
//     `grep -c "^  test(" tooling/ci/test/release-provenance.test.mjs` → 49
//     coverage-manifest.json's row for this file → 51, written by
//       assert-guard-coverage itself, which counts statically; never hand-edited
// The 54 / 15 / 48 / 50 in the block above were right when written and are each
// one case stale now. Which number a sentence means still has to be said, every
// time — that is why they are listed rather than folded into a single "tests".
//
// ── CORRECTION 2026-08-22, before merge — TWO THINGS ABOVE ARE NOW WRONG ─────
// (1) All four numbers moved again, this session, and are re-taken at the foot
//     of this file rather than here, so there is ONE place to read them from.
// (2) "EIGHTEEN mutations, ZERO survivors — and that re-run is the one this
//     file ships on" was true of limb 4 and was read as true of the FILE. It
//     was not. The sweep at the foot of this file enumerated EVERY condition in
//     the guard, 93 of them, and 27 could be switched off with all 55 cases
//     green — none of them limb 4's, which is why the eighteen still stands as
//     a claim about limb 4 and stands as nothing wider. The file now ships on
//     the 93.
describe('assert-release-provenance — a --submit job is gated on an environment', () => {
  test('PASSES the base tree and names the script whose run-time read it checked', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /1 job\(s\) invoke a `--submit` verb/);
    assert.match(out, /tooling\/release\/submit-store\.mjs/);
  });

  test('FAILS when the submit job declares no environment:', () => {
    const { code, out } = run(tree({ submit: submitWorkflow({ environment: null }) }));
    assert.equal(code, 1, out);
    assert.match(out, /job "submit" invokes a `--submit` verb at :\d+ and declares no job-level `environment:`/);
  });

  test('the BLOCK form of environment: is the same gate — no false red', () => {
    // `environment:\n  name: store-publish` is legal YAML GitHub honours. A
    // check anchored to the scalar spelling would fail a correctly-gated lane,
    // which is the scalar-`needs:` lesson one key over.
    const { code, out } = run(tree({ submit: submitWorkflow({ environment: 'block' }) }));
    assert.equal(code, 0, out);
  });

  // ── the half without which `environment:` is decoration ────────────────────
  test('FAILS when the invoked script never reads the environment protection rules', () => {
    const { code, out } = run(tree({ submitScript: SUBMIT_SCRIPT_BLIND }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
    assert.match(out, /FAILS OPEN/);
  });

  test('a script that only DESCRIBES the read in a comment earns no credit', () => {
    // The stripper is load-bearing, not decoration: submit-play.mjs spends ~30
    // lines of comment on this exact check, so a raw text match would credit any
    // script that merely talks about it. Same defect this repo shipped twice
    // (the guard-coverage counter at dd30feb, assert-stamp-platforms.mjs:41-46,
    // whose header records deleting the real `flutter build web` step and
    // staying GREEN because the comment above it said the words).
    const { code, out } = run(tree({ submitScript: SUBMIT_SCRIPT_COMMENT_ONLY }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test('half the read is not the read — an environments GET with no protection_rules FAILS', () => {
    const half = 'const envUrl = `https://api.github.com/repos/${repo}/environments/store-publish`;\n';
    const { code, out } = run(tree({ submitScript: half }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test('and the OTHER half — protection_rules off the WRONG endpoint FAILS too', () => {
    // Pins the `ENV_API_READ.test(code) &&` conjunct. Added 2026-08-21 after an
    // eighteen-mutation re-sweep found dropping it left all 54 cases green: the
    // case above holds `/environments/` without `protection_rules`, and NOTHING
    // held `protection_rules` without `/environments/`. A script reading BRANCH
    // protection has the words and none of the meaning — the environment the
    // store upload actually runs in is never fetched, so its emptiness — the
    // fail-open state measured on this repo, .github/workflows/submit-play.yml:42-45
    // — is never seen.
    const { code, out } = run(tree({ submitScript: SUBMIT_SCRIPT_WRONG_ENDPOINT }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test('a `protection` field that is not `protection_rules` is not the rules read', () => {
    // Pins the `_rules` half of ENV_PROTECTION_READ, found GREEN by the sweep of
    // 2026-08-24: widened to /protection/ the whole suite still passed, because
    // every fixture that carries the word carries the whole token. It is not a
    // widening that can only widen — it hands the run-time credit to a script
    // that fetches the right endpoint and then reads a DIFFERENT field off it,
    // which is the same "confirmed only that the environment exists" verdict the
    // constants' docstring says is not enough. The script below GETs
    // `/environments/store-publish` and never looks at `protection_rules`.
    const nearMiss =
      'const envUrl = `https://api.github.com/repos/${repo}/environments/store-publish`;\n' +
      'const gated = (await (await fetch(envUrl)).json()).protection === true;\n';
    const { code, out } = run(tree({ submitScript: nearMiss }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  // ── the domain floor, and the two ways it is not a pass ────────────────────
  test('COVERAGE LOST when no job invokes a --submit verb anywhere', () => {
    const { code, out } = run(tree({ submit: null }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO jobs invoke a `--submit` verb/);
  });

  test('a --submit verb that exists only in a COMMENT does not populate the domain', () => {
    // Comments are blanked by the shared parser, so this tree has zero real
    // submit jobs — and the floor is what says so. A limb that counted the
    // comment would report a gated lane that does not exist.
    const commented = submitWorkflow({ step: '      # - run: node tooling/release/submit-store.mjs --submit --app subly\n      - run: echo nothing' });
    const { code, out } = run(tree({ submit: commented }));
    assert.equal(code, 1, out);
    assert.match(out, /ZERO jobs invoke a `--submit` verb/);
  });

  test('COVERAGE LOST when the --submit script is not on disk — an unread half is not a passed one', () => {
    const { code, out } = run(tree({ submitScript: null }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /could not read/);
    assert.match(out, /submit-store\.mjs/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ADDED 2026-08-21 — THE TRIPWIRES BIT, BUT THE REFINEMENTS INSIDE THEM WERE
  // NOT HELD BY ANYTHING. Review of the cases above found five details of limb 4
  // that could each be removed with the suite still 48/48 green: the job scoping
  // of the `environment:` read, its ` {4}` indent anchor, SUBMIT_FLAG's
  // whitespace anchors, SUBMIT_SCRIPT's `node` prefix, and the SUBMIT_RUNNER
  // conjunct. The shipped code is right on all five — that is exactly why they
  // needed pinning: a property nothing can turn red is a property nothing is
  // holding. Each case below was built from the mutation it must catch, and each
  // was confirmed RED against a scratch guard carrying that mutation.
  test('the environment: must be on the SUBMITTING job — a sibling job\'s does not count', () => {
    // Pins `job.lines` against `wf.lines`. A file-scoped read passes this tree:
    // the file contains `    environment: store-publish`, just not on the job
    // that uploads to the store.
    const { code, out } = run(tree({ submit: submitWorkflow({ environment: null, otherJob: OTHER_JOB_WITH_ENVIRONMENT }) }));
    assert.equal(code, 1, out);
    assert.match(out, /job "submit" invokes a `--submit` verb at :\d+ and declares no job-level `environment:`/);
  });

  test('a STEP-level `with: environment:` is not a job-level gate', () => {
    // Pins the ` {4}` anchor in `/^ {4}environment:/`. Drop it and an action
    // INPUT named `environment` is read as the approval gate — a lane that
    // pauses for nobody, reported as gated.
    const { code, out } = run(tree({ submit: submitWorkflow({ environment: null, stepsBefore: STEP_LEVEL_ENVIRONMENT }) }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no job-level `environment:`/);
  });

  test('`--submit-preflight` is a DIFFERENT verb — the floor says so rather than passing it', () => {
    // Pins SUBMIT_FLAG's `(?:^|\s)…(?=\s|$)` anchors. As a bare substring match,
    // `--submit` is inside `--submit-preflight`, so a preflight-only lane would
    // be counted as a submit lane and reported gated — a limb ranging over a job
    // that never uploads anything.
    const { code, out } = run(tree({ submit: submitWorkflow({ step: '      - run: node tooling/release/submit-store.mjs --submit-preflight --app subly' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /ZERO jobs invoke a `--submit` verb/);
  });

  test('the script path is read from AFTER `node`, not from the first .mjs on the line', () => {
    // Pins SUBMIT_SCRIPT's `\bnode\b` prefix. `NODE_OPTIONS=--loader=…mjs` puts a
    // `.mjs` to the LEFT of the runner; without the prefix the guard reads
    // `NODE_OPTIONS=--loader=./tooling/release/trace.mjs` as the script, cannot
    // open it, and half (b) is never asked of the real one.
    const step = '      - run: NODE_OPTIONS=--loader=./tooling/release/trace.mjs node tooling/release/submit-store.mjs --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 0, out);
    assert.match(out, /tooling\/release\/submit-store\.mjs/);
    assert.doesNotMatch(out, /COVERAGE LOST/);
  });

  test('a `--submit` with no `node` runner is outside the domain, and the floor is loud about it', () => {
    // Pins the `|| !SUBMIT_RUNNER.test(seg)` conjunct — and STATES ITS LIMIT
    // rather than implying more. limb 4's domain is `node … --submit`; a
    // shebang'd `./submit-store.mjs --submit` is not in it. When it is the ONLY
    // submit-shaped step, the domain floor turns that into a loud COVERAGE LOST,
    // which is what this case holds. It does NOT hold the other case: beside the
    // two `node`-invoked lanes on the real tree, a third direct-exec one would
    // raise no floor and would be missed. Recorded here, not papered over —
    // widening SUBMIT_RUNNER is a scope decision, not a test fix.
    const { code, out } = run(tree({ submit: submitWorkflow({ step: '      - run: ./tooling/release/submit-store.mjs --submit --app subly' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /ZERO jobs invoke a `--submit` verb/);
  });

  test('the verb present with NO nameable script is COVERAGE LOST, not a pass on `environment:` alone', () => {
    // Found by the same mutation sweep, 2026-08-21: `if (call.script === null)`
    // survived being set to `if (false)` with all 53 cases green — the branch the
    // guard's own header promises ("if the verb is present and the script cannot
    // be named, that is COVERAGE LOST below, not a pass") was reachable and
    // untested. `node -e … --submit` reaches it: the verb and the runner are
    // both there and no `.mjs` path is. The job here declares a perfectly good
    // `environment:`, so what must NOT happen is a clean pass on half (a) with
    // half (b) never asked. Asserted on the `(job "…")` spelling, which is the
    // unnameable branch's own message and not the unreadable one below it.
    const { code, out } = run(tree({ submit: submitWorkflow({ step: '      - run: node -e "await upload()" --submit' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /could not read/);
    assert.match(out, /\(job "submit"\)/);
  });

  // ── ADDED 2026-08-24 — the four MATCHER conditions the 2026-08-22 sweep did
  //    not enumerate. Each of these went GREEN under mutation with all 84 cases
  //    passing; each mutation is named beside its case so it can be re-taken.

  test('a `--submit` that OPENS a shell segment is in the domain — the `^` half of the anchor', () => {
    // Pins the `^` alternative in SUBMIT_FLAG's `(?:^|\s)`. `String.split` on a
    // shell separator leaves the next segment starting at index 0 when the
    // separator is unpadded, so `…&&--submit node …` puts the verb where no
    // preceding whitespace exists. Drop the `^` and this job leaves limb 4's
    // domain entirely: the tree then reports `ZERO jobs invoke a --submit verb`
    // instead of the (a)-half FAIL below — the floor is loud, but the ASSERTION
    // is gone, and a narrower matcher is the direction that goes blind.
    const step = '      - run: echo start&&--submit node tooling/release/submit-store.mjs';
    const { code, out } = run(tree({ submit: submitWorkflow({ environment: null, step }) }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no job-level `environment:`/);
    assert.doesNotMatch(out, /COVERAGE LOST/);
  });

  test('`nodemon` is not `node` — the runner word boundaries keep a look-alike out of the domain', () => {
    // Pins the TRAILING `\b` in SUBMIT_RUNNER — that one only, which is the
    // correction of 2026-08-24. `nodemon` has a word boundary on its LEFT, so
    // this fixture cannot see the left `\b` go: dropping it alone left the whole
    // suite green. 'a left-attached `xnode` is not `node`' below is that member's
    // own case. Without the trailing boundary `/node\b/`… `/node/` matches inside
    // `nodemon`, the job enters the domain, and — because SUBMIT_SCRIPT still
    // wants a real `node` — it lands on the UNREADABLE floor instead. Both
    // outcomes exit 1, so the discriminator is WHICH floor speaks.
    const step = '      - run: nodemon tooling/release/submit-store.mjs --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 1, out);
    assert.match(out, /ZERO jobs invoke a `--submit` verb/);
    assert.doesNotMatch(out, /could not read/);
  });

  test('a `.mjsx` path is not a `.mjs` script — the capture does not truncate the extension', () => {
    // Pins the trailing `\b` on SUBMIT_SCRIPT's `(\S+\.mjs)\b`. Drop it and
    // `submit-store.mjsx` is captured as `submit-store.mjs` — a DIFFERENT file
    // that this fixture happens to have on disk and that does perform the read,
    // so the run goes green having checked a script the workflow never invokes.
    const step = '      - run: node tooling/release/submit-store.mjsx --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /could not read/);
    assert.match(out, /\(job "submit"\)/);
  });

  test('the word `environments` is not the `/environments/` API path', () => {
    // Pins ENV_API_READ's two slashes AS A PAIR — and that is all it pins, which
    // is the correction of 2026-08-24. This fixture carries no slash on either
    // side of the word, so it goes red only when BOTH are dropped; each one
    // ALONE survived it with the whole suite green. The two singles are held by
    // the two cases immediately below, and the merged row is exactly the shape
    // that let ten conditions hide behind forty-six table rows.
    // `SUBMIT_SCRIPT_WRONG_ENDPOINT` above holds the other direction
    // (protection_rules off the wrong endpoint); this is the one that made the
    // slashes matter — a local identifier spelled `environments`, beside a real
    // `protection_rules` read, buys the credit the moment the pattern stops
    // demanding the path.
    const submitScript = 'const environments = ["store-publish"];\nconst rules = Array.isArray(json.protection_rules) ? json.protection_rules : [];\n';
    const { code, out } = run(tree({ submitScript }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  // ── ADDED 2026-08-24 — THE MEMBERS THE PREVIOUS TABLE MERGED ────────────────
  // Each case below was built from ONE mutation that the suite could not see,
  // and each mutation is named beside its case so it can be re-taken. They are
  // members of rows an earlier enumeration wrote as single entries ("the word
  // boundaries", "the `node` prefix", "the two slashes"), and a member of a
  // merged row is invisible: a pair only ever fails together.

  test('a bare `environments/` with no leading slash is not the API path', () => {
    // Pins ENV_API_READ's LEADING `\/` on its own. A script that builds the path
    // relative to a base URL never writes the leading slash, so dropping it from
    // the pattern hands the run-time-read credit to any script that merely says
    // the word before a slash.
    const submitScript =
      'const url = new URL(`environments/${name}`, `https://api.github.com/repos/${repo}/`);\n' +
      'const rules = Array.isArray(json.protection_rules) ? json.protection_rules : [];\n';
    const { code, out } = run(tree({ submitScript }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test("the environments LIST endpoint is not one environment's rules", () => {
    // Pins ENV_API_READ's TRAILING `\/` on its own, and this is the materially
    // live half. `GET /repos/{owner}/{repo}/environments` — no trailing segment
    // — enumerates WHICH environments exist. It never fetches one, so it never
    // sees the empty `protection_rules` that is the fail-open state this repo
    // measured on itself (.github/workflows/submit-play.yml:42-45). Drop the
    // trailing slash and that call buys the credit.
    const submitScript =
      'const res = await fetch(`https://api.github.com/repos/${repo}/environments`);\n' +
      'const names = (await res.json()).environments.map((e) => e.name);\n' +
      'const rules = names.length ? [] : json.protection_rules;\n';
    const { code, out } = run(tree({ submitScript }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test('a left-attached `xnode` is not `node` — SUBMIT_RUNNER\'s LEADING word boundary', () => {
    // Pins the LEFT `\b` of SUBMIT_RUNNER. The `nodemon` case above holds the
    // RIGHT one and nothing held this one: drop it and `xnode … --submit` enters
    // limb 4's domain, where SUBMIT_SCRIPT — which still wants a real `\bnode\b`
    // — can name no script, so the run lands on the unread-script floor. The
    // base tree's real submit lane stays in place, so a green run here means the
    // look-alike was ignored rather than that the domain went empty.
    const root = tree();
    writeFileSync(
      join(root, '.github/workflows/lookalike.yml'),
      submitWorkflow({ step: '      - run: xnode tooling/release/submit-store.mjs --submit --app subly' }),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /lookalike\.yml/);
    assert.match(out, /1 job\(s\) invoke a `--submit` verb/);
  });

  test('a decoy `.mjs` attached to an `xnode` is not the script — SUBMIT_SCRIPT\'s LEADING `\\b`', () => {
    // Pins the LEFT `\b` of SUBMIT_SCRIPT, which the `NODE_OPTIONS=--loader=…`
    // case above does NOT reach: there the decoy sits before any `node`-like
    // word at all. Here the decoy path itself contains `node` with a letter
    // glued to its left, so without the boundary the pattern starts matching
    // inside `xnode/` and captures `/shim.mjs` — a file that is not on disk, so
    // half (b) is never asked of the script the workflow really invokes.
    const step =
      '      - run: NODE_OPTIONS=--require=/opt/xnode/shim.mjs node tooling/release/submit-store.mjs --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 0, out);
    assert.match(out, /tooling\/release\/submit-store\.mjs/);
    assert.doesNotMatch(out, /COVERAGE LOST/);
  });

  test('a decoy `.mjs` attached to a `nodemon` is not the script — the `\\b` AFTER `node`', () => {
    // Pins SUBMIT_SCRIPT's `\b` between `node` and the rest. The `nodemon` case
    // above cannot reach it: there SUBMIT_RUNNER rejects the segment before
    // SUBMIT_SCRIPT is ever consulted. Here a REAL `node` is on the same segment,
    // so the segment is in the domain, and the only thing keeping the guard off
    // `mon-dev.mjs` is that boundary. A single `&` is not a segment separator,
    // which is what keeps both commands on one segment.
    const step =
      '      - run: npx nodemon-dev.mjs & node tooling/release/submit-store.mjs --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 0, out);
    assert.match(out, /tooling\/release\/submit-store\.mjs/);
    assert.doesNotMatch(out, /COVERAGE LOST/);
  });

  test('a dotless `...mjs` argument before the script is not the script - SUBMIT_SCRIPT\'s ESCAPED `\\.`', () => {
    // Pins the `\.` inside the capture. It is the one member of SUBMIT_SCRIPT
    // that the four decoy cases around it leave free, because every decoy THEY
    // build keeps a real dot in it. This decoy has no dot at all. Unescape the
    // dot and `\S+` eats `/opt/hooks/loade`, the any-char takes the `r`, `mjs`
    // closes the match - so the lazy `[\s\S]*?` stops on the LOADER and never
    // reaches the script. The guard then tries to read a file that is not in the
    // tree, the run lands on the COVERAGE LOST floor, and half (b) is never
    // asked of the script that actually submits.
    // MEASURED 2026-08-24 on a scratch mirror, before this case existed:
    // `\.` -> `.` left the whole suite green, exit 0, 103 tests, 103 pass.
    const step = '      - run: node /opt/hooks/loadermjs tooling/release/submit-store.mjs --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /COVERAGE LOST/);
    assert.match(out, /tooling\/release\/submit-store\.mjs/);
  });

  test('a decoy `.mjx` before the script is not the script - the `s` of `mjs`', () => {
    // The extension literal has three characters and each is a member. `m`/`j`
    // are held (shortened to `\.mj` the capture changes on every fixture and 86
    // cases go red), and the `s` was held by nothing: MEASURED 2026-08-24 on a
    // scratch mirror, `\.mjs` -> `\.mj\w` left the whole suite green, exit 0,
    // 111 tests, 111 pass. It is the escaped dot's twin - one character in the
    // literal doing all the narrowing - and it goes the same way: with the `s`
    // free, the `.mjx` argument below wins the lazy race, the guard reads a file
    // that is not in the tree, and half (b) is never asked of the real script.
    const step =
      '      - run: node tooling/release/decoy.mjx tooling/release/submit-store.mjs --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /COVERAGE LOST/);
    assert.match(out, /tooling\/release\/submit-store\.mjs/);
  });

  test('a script name that begins where `node` ends - SUBMIT_SCRIPT\'s `*`, not its laziness', () => {
    // Pins the ZERO-WIDTH arm of `[\s\S]*?` against `[\s\S]+?`. That is a
    // different member from the `?` that makes it lazy: the `?` is held by every
    // decoy above (made greedy, they all go red), and nothing held the `*`,
    // because no other fixture in this file puts the capture flush against
    // `node`. MEASURED 2026-08-24 on a scratch mirror, before this case existed:
    // `*?` -> `+?` left the whole suite green, exit 0, 103 tests, 103 pass.
    // `./node-tools.mjs` carries a word boundary on each side of `node`, so the
    // capture opens at `-tools.mjs`. That file is not in the tree, so the
    // shipped guard FAILS CLOSED and names what it could not read. Forced to
    // skip one character, the mutant captures `tools.mjs` instead - a DIFFERENT
    // file, which this fixture puts in the tree fully compliant - so it exits 0
    // having credited a script the workflow never invoked. The silent credit is
    // the outcome being excluded here, not the fail-closed one.
    const step = '      - run: ./node-tools.mjs --submit --app subly';
    const { code, out } = run(
      tree({ submit: submitWorkflow({ step }), extraScript: { path: 'tools.mjs', body: SUBMIT_SCRIPT_REAL } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /-tools\.mjs \(not readable under/);
  });

  test('a bare `.mjs` is not a script path — the `\\S+` inside the capture', () => {
    // Pins `\S+` against `\S*`. Contrived on purpose and said so: an argument
    // that is a bare extension with no stem is not something a human writes. It
    // is still reachable — the guard reads whatever text a workflow carries —
    // and `\S*` would capture `.mjs` as the script name. Both outcomes are
    // COVERAGE LOST, so the discriminator is WHICH floor message speaks: the
    // unnameable branch, or the unreadable one.
    const { code, out } = run(tree({ submit: submitWorkflow({ step: '      - run: node --submit .mjs --app subly' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /\(job "submit"\)/);
    assert.doesNotMatch(out, /not readable under/);
  });

  test('a folded `run: >` whose `node` and `--submit` sit on DIFFERENT physical lines is ONE command', () => {
    // Pins `job.logical` against `job.lines` in the submit-call scan. The guard's
    // own header records that on the two REAL lanes the fold moves only the
    // reported line number, because `node`, the path and `--submit` all land on
    // one physical line there. That is a fact about today's two lanes, not about
    // folding: split the same command across the fold and a raw line scan sees
    // `node` on one line and `--submit` on another, matches neither, and reports
    // the domain EMPTY.
    const step = '      - run: >\n          node tooling/release/submit-store.mjs\n          --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 0, out);
    assert.match(out, /1 job\(s\) invoke a `--submit` verb/);
    assert.doesNotMatch(out, /COVERAGE LOST/);
  });

  test('the script is read from the SUBMITTING segment, not from another one on the line', () => {
    // Pins `seg.match(SUBMIT_SCRIPT)` against `l.text.match(…)`. The submitting
    // segment names no `.mjs` at all; a second segment on the same line does.
    // Read from the whole line, the guard checks a script the `--submit` command
    // never invoked and reports clean — the per-segment rule the dry-run
    // exclusion already pays for, one condition over.
    const step = '      - run: node ./bin/wrapper --submit --app subly && node tooling/release/submit-store.mjs';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /\(job "submit"\)/);
  });

  test('the `node` runner must be on the SUBMITTING segment, not merely on the line', () => {
    // Pins the RECEIVER of `SUBMIT_RUNNER.test(seg)` — the THIRD receiver on
    // that line, and the one nothing held. MEASURED 2026-08-24 on a scratch
    // mirror: `seg` -> `l.text` left the whole suite green, exit 0, 114 tests,
    // 114 pass, 0 fail. Its two siblings ARE held — SUBMIT_FLAG's receiver by
    // 'a `--submit` that OPENS a shell segment', and `seg.match(SUBMIT_SCRIPT)`
    // by the case immediately above — so two of three were pinned and the third
    // was not enumerated at all.
    // It is not a widening: it FLIPS A VERDICT on the line below. One logical
    // line, two shell segments — the first runs `node` and does not submit, the
    // second submits and has no runner. Per SEGMENT nothing in this job invokes
    // `node … --submit`, so the job is outside limb 4 and the run is clean. Read
    // from the WHOLE LINE the runner counts as "present", the runner-less
    // segment enters the domain, SUBMIT_SCRIPT can name no script on it, and the
    // run dies on the unread-script floor — COVERAGE LOST on a lane that invokes
    // no `node … --submit` at all. Measured both ways on the fixture below:
    // shipped exit 0, receiver widened exit 1 naming `split-runner.yml`.
    // The base tree's real submit lane stays in place, so a green run here means
    // the runner-less segment was ignored rather than that the domain went empty.
    const root = tree();
    writeFileSync(
      join(root, '.github/workflows/split-runner.yml'),
      submitWorkflow({
        environment: null,
        step: '      - run: node tooling/release/submit-store.mjs --app subly && ./tooling/release/shipit.sh --submit',
      }),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /split-runner\.yml/);
    assert.match(out, /1 job\(s\) invoke a `--submit` verb/);
  });

  test('the (a) FAIL names the FIRST `--submit` call in the job, not the last', () => {
    // Pins `job.submitCalls[0]`. The existing no-environment case asserts only
    // `at :\d+`, so `[job.submitCalls.length - 1]` passed it: with one call the
    // two indices are the same line. With two they are not, and the message
    // should point at where the lane STARTS submitting.
    const submit = submitWorkflow({
      environment: null,
      stepsBefore: '      - run: node tooling/release/submit-store.mjs --submit --app first\n',
      step: '      - run: node tooling/release/submit-store.mjs --submit --app second',
    });
    const at = submit.split('\n').flatMap((l, i) => (l.includes('--submit') ? [i + 1] : []));
    assert.equal(at.length, 2, submit);
    assert.notEqual(at[0], at[1]);
    const { code, out } = run(tree({ submit }));
    assert.equal(code, 1, out);
    assert.match(out, new RegExp('invokes a `--submit` verb at :' + at[0] + ' and declares no job-level'));
  });

  test('limb 4 (b) checks EVERY `--submit` call in the job, not just the first', () => {
    // Pins the LOOP BOUND `for (const call of job.submitCalls)` — the iteration
    // itself, not its body. MEASURED 2026-08-24 on a scratch copy:
    // `job.submitCalls.slice(0, 1)` left this whole suite green (101 tests, 101
    // pass, 0 fail, exit 0) before this case existed, because the case above is
    // the only other two-call fixture and BOTH its calls name the same script.
    // It is neither an equivalence nor a widening: the job below declares its
    // `environment:`, its FIRST script performs the run-time protection-rules
    // read, and its SECOND never looks at the environment at all. Truncated to
    // one call the guard exits 0 and its `ok` line asserts that each script
    // performs the read — a claim about a script it never opened.
    const submit = submitWorkflow({
      stepsBefore: '      - run: node tooling/release/submit-store.mjs --submit --app first\n',
      step: '      - run: node tooling/release/submit-blind.mjs --submit --app second',
    });
    const { code, out } = run(
      tree({ submit, extraScript: { path: 'tooling/release/submit-blind.mjs', body: SUBMIT_SCRIPT_BLIND } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /invokes `tooling\/release\/submit-blind\.mjs --submit` at :\d+/);
    assert.match(out, /never reads the deployment environment's protection rules/);
    // The second script is READ, not merely unfound — otherwise the COVERAGE
    // LOST floor would be speaking and the (b) assertion would never be made.
    assert.doesNotMatch(out, /COVERAGE LOST/);
    // The FIRST call is clean, so only the loop's second iteration can have
    // produced that FAIL.
    assert.doesNotMatch(out, /invokes `tooling\/release\/submit-store\.mjs --submit`/);
  });

  test('a four-space key merely STARTING with `environment` is not the approval gate', () => {
    // Pins the trailing `:` in `/^ {4}environment:/`. The ` {4}` case above holds
    // the indent and nothing held the colon: drop it and any job-level key whose
    // name begins with the word — `environment_url:` here — is read as the
    // approval gate, which is the same false credit at a different offset.
    const submit = submitWorkflow({ environment: null }).replace(
      '    steps:',
      '    environment_url: https://example.test/store\n    steps:',
    );
    const { code, out } = run(tree({ submit }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no job-level `environment:`/);
  });

  // -- ADDED 2026-08-24, THIRD PASS - THE MEMBERS THE SECOND PASS STILL MERGED
  // Same finding one level finer: a row that names a construct hides the
  // members of that construct. Each case below was built from ONE mutation
  // that the 103-case suite could not see, measured on a scratch mirror with
  // the repo tree never touched, and each mutation is named beside its case.

  test('a `--submit` GLUED to the end of another token is not the verb - the `(?:^|\\s)` prefix ITSELF', () => {
    // SUBMIT_FLAG's prefix group has THREE members, not two: the `^` arm, the
    // `\s` arm, and the requirement that one of them hold at all. The two arms
    // have their own cases above and each goes red alone. Dropping the WHOLE
    // group left the suite green - MEASURED 2026-08-24 on a scratch mirror,
    // exit 0, 103 tests, 103 pass - because no fixture here ever writes
    // `--submit` glued to a preceding character. Unprefixed, `--app=x--submit`
    // reads as the verb, and the lane below - which submits nothing and so
    // declares no `environment:` - collects an invented (a)-half FAIL.
    const root = tree();
    writeFileSync(
      join(root, '.github/workflows/glued.yml'),
      submitWorkflow({
        environment: null,
        step: '      - run: node tooling/release/submit-store.mjs --app=nikatru--submit',
      }),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /glued\.yml/);
    assert.match(out, /1 job\(s\) invoke a `--submit` verb/);
  });

  test('`--submitted` is not `--submit` - the LITERAL inside SUBMIT_FLAG', () => {
    // The flag has members too: the `--`, the word, and the lookahead. The `--`
    // and the lookahead each go red alone; the WORD did not. MEASURED 2026-08-24
    // on a scratch mirror: `--submit` -> `--subm\w*` left the whole suite green,
    // exit 0, 111 tests, 111 pass, because nothing here writes a longer flag
    // that starts the same way. Widened, a past-tense flag on a lane that
    // submits nothing pulls that lane into limb 4 and collects an (a)-half FAIL
    // it has no business collecting - a false red on a correct workflow, which
    // is the failure this file's header says costs more than a miss.
    const root = tree();
    writeFileSync(
      join(root, '.github/workflows/pasttense.yml'),
      submitWorkflow({
        environment: null,
        step: '      - run: node tooling/release/submit-store.mjs --submitted',
      }),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /pasttense\.yml/);
    assert.match(out, /1 job\(s\) invoke a `--submit` verb/);
  });

  test('a SINGULAR `deployment_protection_rule` id is not the `protection_rules` array', () => {
    // The third member of ENV_PROTECTION_READ, after the `protection` half and
    // the underscore: the word `rules`. MEASURED 2026-08-24 on a scratch mirror,
    // `protection_rules` -> `protection_rule\w*` left the whole suite green,
    // exit 0, 111 tests, 111 pass. `deployment_protection_rule` is a REAL and
    // DIFFERENT GitHub object - the custom deployment protection rule an app
    // registers, which is also the name of a webhook event - and reading its id
    // off a response says nothing about whether a human must approve. Note the
    // near-miss has to break the word: `protection_ruleset` would still contain
    // `protection_rules` and could not tell the two patterns apart.
    const nearMiss =
      'const envUrl = `https://api.github.com/repos/${repo}/environments/store-publish`;\n' +
      'const ruleId = (await (await fetch(envUrl)).json()).deployment_protection_rule_id;\n';
    const { code, out } = run(tree({ submitScript: nearMiss }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test('the SINGULAR `/environment/` path is not the environments API', () => {
    // Pins the LITERAL `environments` inside ENV_API_READ - a third member
    // beside the two slashes, which have their own cases above. Widened to
    // `/\/environment\w*\//` the suite stayed green: MEASURED 2026-08-24 on a
    // scratch mirror, exit 0, 103 tests, 103 pass, because every fixture that
    // writes the path writes it correctly. It is not a widening that can only
    // widen. The REST route is `/repos/{owner}/{repo}/environments/{name}`; a
    // script that GETs `/environment/...` fetches a 404 whose body has no
    // `protection_rules` in it at all, and would still buy the run-time credit.
    const submitScript =
      'const envUrl = `https://api.github.com/repos/${repo}/environment/store-publish`;\n' +
      'const rules = Array.isArray(envJson.protection_rules) ? envJson.protection_rules : [];\n';
    const { code, out } = run(tree({ submitScript }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test('a `_rules` field that is not `protection_rules` is not the rules read', () => {
    // The MIRROR of 'a `protection` field that is not `protection_rules`...'
    // above, and the member that case does not hold: narrowed to `/_rules/`,
    // ENV_PROTECTION_READ still passed the whole suite - MEASURED 2026-08-24 on
    // a scratch mirror, exit 0, 103 tests, 103 pass. A deployment-branch policy
    // is a different field on the same endpoint: it says which branches may
    // deploy, never whether a human has to approve, so crediting it credits an
    // unreviewed lane while the fixture reads the right endpoint.
    const nearMiss =
      'const envUrl = `https://api.github.com/repos/${repo}/environments/store-publish`;\n' +
      'const branchRules = (await (await fetch(envUrl)).json()).deployment_branch_policy_rules ?? [];\n';
    const { code, out } = run(tree({ submitScript: nearMiss }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test('a `.mjs.mjs` path is the WHOLE token - the GREED of `\\S+`', () => {
    // `\S+` has two members: the class (held by 'a bare `.mjs` is not a script
    // path', which swaps `+` for `*`) and its GREED, which nothing held.
    // MEASURED 2026-08-24 on a scratch mirror: `\S+` -> `\S+?` left the whole
    // suite green, exit 0, 109 tests, 109 pass, because no fixture here carries
    // a token with TWO `.mjs` in it. A doubled extension is a real typo, and it
    // is the only shape where the two differ: greedy takes the whole token, so
    // the guard reads the path the workflow actually wrote and fails closed when
    // it is not there; lazy stops at the FIRST `.mjs`, silently rewriting the
    // path into a neighbouring file that does exist and crediting that instead.
    const step = '      - run: node tooling/release/submit-store.mjs.mjs --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /submit-store\.mjs\.mjs \(not readable under/);
  });

  test('the words `protection rules` in a message are not the `protection_rules` field', () => {
    // Pins the UNDERSCORE inside ENV_PROTECTION_READ - the same class of member
    // as SUBMIT_SCRIPT's escaped dot, one character inside a literal that is
    // doing all the narrowing. MEASURED 2026-08-24 on a scratch mirror:
    // `protection_rules` -> `protection.rules` left the whole suite green, exit
    // 0, 109 tests, 109 pass. It is not a widening that can only widen: `.`
    // matches a SPACE, so any script that merely TALKS about protection rules in
    // a runtime string - the diagnostic below is the natural way to write it -
    // buys the run-time credit while never reading the field. Comment stripping
    // does not help here; this text is in live code.
    const nearMiss =
      'const envUrl = `https://api.github.com/repos/${repo}/environments/store-publish`;\n' +
      'if (!envJson) throw new Error("cannot see the protection rules for " + envUrl);\n';
    const { code, out } = run(tree({ submitScript: nearMiss }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test('the limb-4 `ok` line COUNTS the scripts it opened and names them in a stable order', () => {
    // Pins two things the `ok` line carries that nothing asserted: the count
    // `${submitScriptsChecked.size}`, and the `.sort()` on the join. MEASURED
    // 2026-08-24 on a scratch mirror: `size` -> `size + 1`, and the `.sort()`
    // dropped, EACH left the whole suite green, exit 0, 103 tests, 103 pass -
    // because every other fixture in this file opens exactly one script, where
    // a count cannot be wrong by arithmetic and an order cannot be wrong at all.
    // `aaa-submit.yml` sorts BEFORE `submit.yml` in the workflow walk, so the
    // set is populated zzz-first and only the sort puts the names back in the
    // order this guard's own coverage report is read in.
    const root = tree({ extraScript: { path: 'tooling/release/zzz-submit.mjs', body: SUBMIT_SCRIPT_REAL } });
    writeFileSync(
      join(root, '.github/workflows/aaa-submit.yml'),
      submitWorkflow({ step: '      - run: node tooling/release/zzz-submit.mjs --submit --app other' }),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(
      out,
      /2 job\(s\) invoke a `--submit` verb; 2 script\(s\) opened for the run-time half \(tooling\/release\/submit-store\.mjs, tooling\/release\/zzz-submit\.mjs\)/,
    );
  });

  // ── ADDED 2026-08-24, FOURTH PASS — THE CASE-SENSITIVITY MEMBERS, AND WHY
  //    "IT CAN ONLY MATCH MORE" IS NOT A DISPOSITION ─────────────────────────
  // The four rows below were carried into this round as PURE WIDENINGS to be
  // declared rather than pinned: each mutation matches a strict SUPERSET of what
  // the shipped pattern matches, so the reasoning went, no input can separate
  // them. THE REASONING IS WRONG AND WAS MEASURED WRONG. A matcher that only
  // ever matches MORE still flips an exit code wherever what it feeds decides a
  // FAIL — and TWO of the four flip it in the BLIND direction, handing limb 4
  // (b)'s credit to a script that performs no read at all. Every pair below was
  // run both ways on a scratch tree before its case was written, and each case
  // names the pair it was built from. "Superset" is a fact about the pattern;
  // "cannot change a verdict" is a claim about the guard, and only the second
  // one is a reason to leave an atom free.

  test('a `---submit` argument is not the verb — the DASH COUNT in SUBMIT_FLAG', () => {
    // Pins the multiplicity of `--`. `-{2,}submit` passed all 114 cases before
    // this one existed. MEASURED 2026-08-24 on the tree below: shipped EXIT 0,
    // `-{2,}` EXIT 1. A triple dash is not a flag any CLI parses, so the lane
    // here submits nothing and correctly declares no `environment:`; widened,
    // the guard pulls it into limb 4 and invents an (a)-half FAIL on it — the
    // false red this file's header says costs more than a miss. The NARROWING
    // direction is a different atom and was already red: `-submit`, one dash,
    // empties the domain and the floor speaks.
    const root = tree();
    writeFileSync(
      join(root, '.github/workflows/tripledash.yml'),
      submitWorkflow({
        environment: null,
        step: '      - run: node tooling/release/submit-store.mjs ---submit',
      }),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /tripledash\.yml/);
    assert.match(out, /1 job\(s\) invoke a `--submit` verb/);
  });

  test('an uppercase `.MJS` argument is not the script — SUBMIT_SCRIPT is CASE-SENSITIVE', () => {
    // Pins the absence of the `i` flag on SUBMIT_SCRIPT, which passed all 114
    // cases. MEASURED 2026-08-24 on the step below: shipped EXIT 0, `/i` EXIT 1
    // with COVERAGE LOST. The capture is LAZY, so case decides WHICH token wins
    // the race: case-insensitively the preload argument does, and the guard then
    // opens a file that is not in the tree instead of the script the workflow
    // invokes. Same shape as the `.mjx` decoy one row over, at the one atom that
    // decoy leaves free — it differs from `.mjs` by a letter, this one by a
    // letter's CASE.
    const step =
      '      - run: node /opt/hooks/PRELOAD.MJS tooling/release/submit-store.mjs --submit --app subly';
    const { code, out } = run(tree({ submit: submitWorkflow({ step }) }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /COVERAGE LOST/);
    assert.match(out, /tooling\/release\/submit-store\.mjs/);
  });

  test('an UPPER-CASE `/ENVIRONMENTS/` is not the API route', () => {
    // Pins the absence of `i` on ENV_API_READ, and this is one of the two that
    // widen in the BLIND direction. MEASURED 2026-08-24 on the script below:
    // shipped EXIT 1 (the (b) FAIL speaks), `/i` EXIT 0 — a silent credit. The
    // REST route `/repos/{owner}/{repo}/environments/{name}` is lower-case; a
    // GET at `/ENVIRONMENTS/…` answers 404 with no `protection_rules` in it, so
    // the script below reads nothing and must not be credited for it.
    const submitScript =
      'const envUrl = `https://api.github.com/repos/${repo}/ENVIRONMENTS/store-publish`;\n' +
      'const rules = Array.isArray(envJson.protection_rules) ? envJson.protection_rules : [];\n';
    const { code, out } = run(tree({ submitScript }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

  test('a wrong-CASE `PROTECTION_RULES` reads undefined and is not the rules read', () => {
    // Pins the absence of `i` on ENV_PROTECTION_READ — the second blind-direction
    // widening. MEASURED 2026-08-24 on the script below: shipped EXIT 1, `/i`
    // EXIT 0. `protection_rules` is the key GitHub returns; the property access
    // below evaluates to `undefined` on every response, so this script GETs the
    // right endpoint and then checks nothing. Crediting it is precisely the
    // "confirmed the environment exists" state the docstring above says is not
    // enough, minus even that.
    const submitScript =
      'const envUrl = `https://api.github.com/repos/${repo}/environments/store-publish`;\n' +
      'const rules = envJson.PROTECTION_RULES ?? [];\n';
    const { code, out } = run(tree({ submitScript }));
    assert.equal(code, 1, out);
    assert.match(out, /never reads the deployment environment's protection rules/);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// THE EXHAUSTIVE SWEEP, 2026-08-22 — EVERY CONDITION IN THE GUARD, NOT JUST
// limb 4's.
//
// Every previous sweep on this pair ranged over limb 4 alone. This one
// enumerated EVERY condition in assert-release-provenance.mjs — 93 mutations:
// each `if (…)` set to `if (false)`, each `&&`/`||` conjunct dropped one at a
// time, each predicate callback neutered, each `??` fallback removed — against
// a scratch COPY of the guard and its three shared modules (the repo tree was
// never mutated), five parallel shards, a green baseline asserted before the
// first mutation and again after the last in every shard, and every anchor
// required to match exactly once.
//
//     BEFORE  93 mutations · 66 RED · 27 GREEN SURVIVORS  (55 cases)
//     AFTER   93 mutations · 92 RED ·  1 GREEN SURVIVOR   (84 cases)
//
// 27 conditions could be switched off with all 55 cases still passing. That is
// the finding, and the cases below are its repair: 27 pins, 3 deletions with
// proofs in the guard beside the code that went, and 1 residual this suite
// cannot reach, named openly at the end rather than left to be discovered.
//
// TWO HONEST FOOTNOTES ON THE NUMBERS, because a sweep result is only worth the
// care taken over how it was read:
//   · SIX of the BEFORE run's 66 "RED" rows were not reds. They carried
//     `exit=4294967295` or a `tests=1 pass=0 fail=1` runner abort — a killed
//     process under five-way parallelism, not a failing assertion. The AFTER
//     run was audited row by row for that signature and every one of its 92
//     reds is a clean `exit=1 tests=84`; three of the six (E3, E4, E5 in the
//     table) turned out to be genuine survivors once re-run, and are pinned by
//     'the gate-constituent walk' below. A non-zero exit is not a red until you
//     have looked at what produced it.
//   · One AFTER row is `RED-BY-HANG`: the cycle guard in the gate-constituent
//     walk does not fail when removed, it SPINS. Measured under a 150-second
//     cap rather than left to run. A hang is a red in any runner with a
//     timeout, but it is a different observation and is written as one.
//
// THE THREE DELETIONS, each recorded where it happened, not only here:
//   · `.filter(Boolean)` after the workflow parse. `parseWorkflow` returns null
//     on exactly one condition — the file not existing — and every path came
//     from `listDir` on that directory. Unfalsifiable, and its only reachable
//     effect would have been to DROP an unparseable workflow and carry on.
//   · limb 3's fourth conjunct `&& !findGate(wf, job).clean`. Provably dead:
//     `clean` is assigned only under `if (j.gateCall)`, so `clean` truthy
//     implies `anyGated` true, and the only push in that block is under
//     `!anyGated`.
//   · `!p.viaCommand &&` in the publish classifier's action pass — the one
//     found by WRITING the fixture meant to pin it and watching the fixture
//     prove it could not be pinned. The proof is beside the deletion.
//     🔴 THAT SENTENCE IS FALSE AND WAS MEASURED FALSE 2026-08-24. A fixture
//     does distinguish the two, and it is now committed: 'a `command:` naming
//     the action ITSELF is a publish at its own line' above. The deletion still
//     stands — its direction is monotone, it can only ADD a publish entry — but
//     it is HELD now rather than argued, and the guard's own comment beside the
//     deletion has been rewritten to say what actually reproduces.
//
// THE ONE RESIDUAL, stated as a fact and not as a plan: the stripper self-check
// `if (wf.rawStepCount > 0 && wf.strippedStepCount === 0)` still survives
// `if (false)` with everything below green, and NO fixture can change that. Its
// two numbers come from the same file through workflow-scan.mjs's stripper,
// which blanks a line from a ` #` rightwards or blanks a whole `^\s*#` line —
// neither of which can remove a `- run:`/`- name:`/`- uses:` prefix that the
// raw count already matched. Its failing input is a BROKEN STRIPPER, not a
// workflow, and it is held where such an input exists:
// tooling/ci/test/workflow-scan.test.mjs's 'the strip-count pair is real'
// asserts rawStepCount === 1 and strippedStepCount === 1, which a stripper that
// ate the file turns red. The conjunct INSIDE it is pinnable and is pinned
// below ('a workflow with jobs but no steps at all is NOT COVERAGE LOST').
//
// ── 🔴 CORRECTION 2026-08-24 — "EVERY CONDITION" WAS NOT EVERY CONDITION ─────
// The headline above ("EVERY condition … 93 mutations … 92 RED · 1 GREEN
// SURVIVOR") does not reproduce, and the miss has one shape: the 93 ranged over
// `if`s, conjuncts, predicates and `??`s, and NOT over the MATCHER CONSTANTS
// those conditions call. A regex alternative or a `\b` is a condition too.
//
// RE-SWEPT 2026-08-24 against the 84-case suite as it stood before this
// correction: 46 mutations over the added hunks only — the four SUBMIT_FLAG
// alternation/lookahead members, the boundaries and quantifiers inside
// SUBMIT_RUNNER / SUBMIT_SCRIPT / ENV_API_READ / ENV_PROTECTION_READ, every
// `if` in limb 4 and its two floors, both loop bounds, both `.some` predicates
// on the publish line, both conjuncts inside each, both ternary arms, the three
// limb-3 conjuncts and both `submitProblems++` counters. Three isolated scratch
// mirrors, per-run cap 300 s, every anchor required to match exactly once
// (46/46), every mutant `node --check`-clean before it ran, and six baselines
// (3 pre + 3 post) all `exit=0 tests=84 pass=84 fail=0`.
//     40 RED · 6 GREEN SURVIVORS
// The six, and what became of each — all six are new cases or a deletion above,
// so this block's claim is now true of the file it sits in:
//   · SUBMIT_FLAG's `^` alternative        → pinned ('a `--submit` that OPENS a
//     shell segment'). Removing it NARROWS the domain, which is the blind
//     direction, and the suite could not see it.
//   · SUBMIT_RUNNER's `\b…\b`              → pinned ('`nodemon` is not `node`').
//   · SUBMIT_SCRIPT's trailing `\b`        → pinned ('a `.mjsx` path is not a
//     `.mjs` script'). This one goes fully GREEN under mutation: the guard
//     checks a script the workflow never names and exits 0.
//   · ENV_API_READ's two slashes           → pinned ('the word `environments` is
//     not the `/environments/` API path'). Also fully green under mutation.
//   · the `submitProblems++` inside (b)    → pinned ('a (b)-half failure disowns
//     the line too'). Its sibling in (a) was already RED; half the 2026-08-22
//     `ok`-line repair was held and half was not.
//   · `|| '(none)'` on the submitScriptsChecked join → DELETED, not pinned. It
//     is dead by construction; the proof is beside the `ok` call in the guard.
// I did NOT re-take the RED-BY-HANG row: the cycle-guard mutation is outside
// the added hunks and I left it alone, so the "150-second cap" above is a number
// from 2026-08-22 and not one of mine.
//
// ── 🔴 CORRECTION 2026-08-24, SECOND PASS — "ALL SIX … SO THIS BLOCK'S CLAIM IS
//    NOW TRUE OF THE FILE IT SITS IN" WAS NOT TRUE, and the reason is the one
//    thing this block keeps re-learning one level down: A ROW IS NOT A
//    CONDITION. The 46-row sweep above wrote "SUBMIT_RUNNER's `\b…\b`" and
//    "ENV_API_READ's two slashes" as SINGLE rows. Each is a PAIR, and a pair
//    only ever fails together — so sweeping the pair reported it pinned while
//    each member on its own stayed green with the entire suite passing. Two more
//    conditions had no row at all: SUBMIT_SCRIPT's `[^\n]` class and its `\S+`.
//
//    RE-BUILT FROM SCRATCH rather than audited, because a merged row is
//    invisible to an audit OF rows. The enumeration was taken mechanically from
//    `git diff main --` over the two files and written down BEFORE anything ran,
//    splitting every boolean, every regex alternative, every boundary, every
//    character class and every quantifier, and covering the fixture branches in
//    THIS file as well as the guard's conditions. Four isolated scratch mirrors,
//    the repo tree never mutated, every anchor required to match exactly once,
//    and the green baseline re-taken in the mirror before the first mutation.
//        66 ROWS ENUMERATED. Four of them are DELETIONS with nothing left to
//        mutate — `.filter(Boolean)`, `!p.viaCommand &&`, limb 3's fourth
//        conjunct and `|| '(none)'`, all recorded above — so 62 mutants ran:
//        59 RED · 3 non-reds, none of which is a surviving condition:
//          · `[^\n]` restored into SUBMIT_SCRIPT — the DELETED row. Its green is
//            the PROOF the deletion was inert, not a survivor. Why no segment
//            can carry a newline is written beside SUBMIT_SCRIPT in the guard.
//          · `job.lines` → `job.logical` on limb 4 (a). The two are provably the
//            same set for a `^ {4}` key on any well-formed job; the proof is at
//            the code site, and the predicate they feed is pinned.
//          · this file's `environment === 'block'` fixture branch. The guard's
//            ` {4}environment:` anchor accepts both spellings by construction,
//            so no verdict can differ — declared beside the branch.
//    ELEVEN conditions moved from green to red this pass, each with its own
//    case: SUBMIT_RUNNER's leading `\b` · SUBMIT_SCRIPT's leading `\b` ·
//    SUBMIT_SCRIPT's `\b` after `node` · SUBMIT_SCRIPT's `\S+` ·
//    ENV_API_READ's leading `\/` · ENV_API_READ's trailing `\/` ·
//    `shellSegments(cmd)` in the action pass · `job.logical` in the submit-call
//    scan · `seg.match(SUBMIT_SCRIPT)` · `job.submitCalls[0]` · and the trailing
//    `:` in `/^ {4}environment:/`.
//
// -- CORRECTION 2026-08-24, THIRD PASS -- "66 ROWS ENUMERATED ... 59 RED · 3
//    NON-REDS, NONE OF WHICH IS A SURVIVING CONDITION" WAS ALSO NOT TRUE, and
//    the reason is the second pass's own lesson taken one level further in.
//    The second pass split every CONSTRUCT - each boundary, each alternative,
//    each class, each quantifier - and that is still coarser than a
//    condition. A CHARACTER can be a condition. This pass mutated the four
//    patterns ONE CHARACTER AT A TIME instead of one construct at a time, and
//    ELEVEN more conditions came back green with all 103 cases passing:
//      1  SUBMIT_SCRIPT  the escaped dot `\.`      (capture lands on a
//         dotless `...mjs` token and the real script is never read)
//      2  SUBMIT_SCRIPT  the `s` of the literal `mjs`
//      3  SUBMIT_SCRIPT  the ZERO-WIDTH arm of `[\s\S]*?`, distinct from the
//         `?` that makes it lazy (`+?` still passed everything)
//      4  SUBMIT_SCRIPT  the GREED of `\S+`, distinct from its `+`
//      5  SUBMIT_FLAG    the EXISTENCE of the `(?:^|\s)` group, distinct from
//         its two alternatives, which each already had a case
//      6  SUBMIT_FLAG    the word `submit` inside the flag
//      7  ENV_API_READ   the word `environments` between the two slashes
//      8  ENV_PROTECTION_READ  the `protection` half (the `_rules` half had a
//         case; its mirror did not)
//      9  ENV_PROTECTION_READ  the UNDERSCORE
//     10  ENV_PROTECTION_READ  the word `rules`
//     11  the limb-4 `ok` census: BOTH the script COUNT and the `.sort()` on
//         the join, unfalsifiable while every fixture opened exactly one
//         script
//    All eleven are pinned by eleven cases added above, four of them under the
//    ADDED 2026-08-24, THIRD PASS heading and the other seven placed beside the
//    members they belong with; every one names its own mutation in its own
//    comment, so a row can be re-taken from the case. Each was re-run
//    and each takes the suite to exit 1, 114 tests, 113 pass, 1 fail.
//    FOUR rows are green and stay green, and every one of them is a
//    DECLARED green with its proof beside the code, not a survivor:
//      · `[^\n]` restored into SUBMIT_SCRIPT - the deleted row; the green IS
//        the proof the deletion was inert.
//      · `job.lines` -> `job.logical` on limb 4 (a) - provably the same set
//        for a `^ {4}` key; proof at the code site.
//      · `.filter(Boolean)` restored on the workflow map - proof at the code
//        site that `parseWorkflow` cannot return null here.
//      · `&& !findGate(wf, job).clean` restored on limb 3 - proof at the code
//        site that the conjunct is true on every path where it could matter.
//    Four scratch mirrors, four workers, the repo tree never mutated, every
//    anchor required to match exactly once, and a green baseline taken in the
//    mirror before the first mutation.
//
// -- CORRECTION 2026-08-24, FOURTH PASS -- TWO FINDINGS, AND ONE OF THEM IS
//    ABOUT THE DISPOSITION "PURE WIDENING" RATHER THAN ABOUT AN ATOM.
//
//    1. THE RECEIVER INSIDE AN OPERAND. The third pass mutated the four
//       patterns one character at a time and still read
//       `SUBMIT_FLAG.test(seg) || !SUBMIT_RUNNER.test(seg)` as two operands.
//       There are THREE receivers on that line and only two were held.
//       SUBMIT_RUNNER's, swapped to `l.text`, left the whole 114-case suite
//       green - MEASURED on a scratch mirror, exit 0, 114 tests, 114 pass, 0
//       fail - and flips a verdict: on a line whose first segment runs `node`
//       without submitting and whose second submits without a runner, shipped
//       EXIT 0 and the swap EXIT 1 with COVERAGE LOST. Pinned by 'the `node`
//       runner must be on the SUBMITTING segment, not merely on the line', and
//       the rule that finds it is written beside the code: EVERY RECEIVER IS AN
//       ATOM, not only the expression it sits in.
//
//    2. "IT CAN ONLY EVER MATCH MORE" IS NOT A REASON TO LEAVE AN ATOM FREE,
//       and four rows were carried into this pass on exactly that reasoning:
//       SUBMIT_FLAG's dash multiplicity and the `i` flag on SUBMIT_SCRIPT,
//       ENV_API_READ and ENV_PROTECTION_READ. Each mutant does match a strict
//       SUPERSET. All four still flip an exit code, because a matcher feeds a
//       boolean that decides a FAIL, and TWO of them flip it in the BLIND
//       direction - `/i` on either ENV_ pattern credits a script that reads a
//       404 route or an undefined key. Measured pair by pair on scratch trees
//       before the cases were written: dash `EXIT 0 -> 1` - SUBMIT_SCRIPT `/i`
//       `EXIT 0 -> 1` - ENV_API_READ `/i` `EXIT 1 -> 0` - ENV_PROTECTION_READ
//       `/i` `EXIT 1 -> 0`. All four are pinned above under the FOURTH PASS
//       heading. Superset-ness is a fact about the PATTERN; verdict-neutrality
//       is a claim about the GUARD, and only the second one disposes of a row.
//
//    WHAT IS DECLARED RATHER THAN PINNED, and it is a short list: the two
//    REPORT-TEXT greens on the limb-4 `ok` line - `${publishJobs}` and the
//    prose tail after the script list. Both were measured both ways and BOTH
//    EXIT 0 either way, the printed sentence the only difference; the reasons
//    are written at the code site beside the `ok` call, together with why the
//    two census numbers on that same line are pinned and this third one is not.
//    The line is tight over the prefix its case matches, and NOT over its tail;
//    no comment in either file claims otherwise, and none should acquire one.
// ─────────────────────────────────────────────────────────────────────────────

/** An ungated, unrecorded publish. Dropped into a tree by filename, it is the
 *  cheapest way to ask "did the guard SEE this file?" — if it did, it fails. */
const UNGATED_PUBLISH_WF =
  'name: X\non:\n  push:\njobs:\n  ship:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: gh release create v1 app.zip\n';

/** A register with the base served lane plus one extra channel, so the
 *  served-lane floor stays satisfied while the extra row exercises one conjunct
 *  of the row filter. */
const registerWith = (extra) =>
  JSON.stringify(
    { channels: [{ id: 'web', served: true, lane: { workflow: '.github/workflows/deploy.yml', job: 'deploy' } }, extra] },
    null,
    2,
  );

describe('assert-release-provenance — the floors ABOVE the job parse', () => {
  test('COVERAGE LOST when assert-gate-passed.mjs no longer declares its GATE name', () => {
    // Pins `if (!gateCheckMatch)`. The script is PRESENT — that is a different
    // floor, already held — but the name this guard derives the gate-verdict
    // job from is gone. Without this the next line indexes null and the guard
    // dies with a TypeError instead of saying which single-declaration rule
    // ([pipeline F-2]) was broken.
    const { code, out } = run(tree({ gateScriptBody: "const CHECK_NAME = 'ci-gate';\n" }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no longer declares/);
  });

  test('COVERAGE LOST when .github/workflows does not exist at all', () => {
    // Pins `if (!existsSync(wfDir))`. A repo root pointed one directory too high
    // is the everyday way to reach this, and every limb below it would then
    // range over nothing and print clean.
    const { code, out } = run(tree({ workflowDir: 'absent' }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /\.github\/workflows does not exist/);
  });

  test('COVERAGE LOST when .github/workflows exists but holds no workflow files', () => {
    // Pins `if (wfFiles.length === 0)` — the directory is there, the files are
    // not, which is a different failure from the one above and gets its own say.
    const { code, out } = run(tree({ workflowDir: 'empty' }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /contains no workflow files/);
  });

  test('COVERAGE LOST when the files parse but not one job comes out', () => {
    // Pins `if (totalJobs === 0)`. Three well-formed YAML files with no `jobs:`
    // key: the file floor is satisfied, the job parser reaches nothing, and
    // without this every limb is vacuously true.
    const jobless = 'name: N\non:\n  push:\n';
    const { code, out } = run(tree({ build: jobless, deploy: jobless, submit: jobless }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /found ZERO jobs/);
  });

  test('a workflow with jobs but no steps at all is NOT COVERAGE LOST', () => {
    // Pins the `wf.rawStepCount > 0 &&` conjunct of the stripper self-check. A
    // job in `uses:` form — a reusable-workflow call — has zero steps in both
    // counts, and without the conjunct `0 === 0` reads as "the stripper ate the
    // file" and false-reds a perfectly ordinary workflow.
    const reusable = 'name: R\non:\n  workflow_call:\njobs:\n  call_build:\n    uses: ./.github/workflows/build.yml\n';
    const root = tree();
    writeFileSync(join(root, '.github/workflows/reusable.yml'), reusable);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /COVERAGE LOST/);
  });

  test('a `.yaml` workflow is scanned, not only `.yml`', () => {
    // Pins the `|| f.endsWith('.yaml')` half of the extension filter. GitHub
    // runs both spellings; a guard that reads one of them reports clean on a
    // lane it never opened.
    const root = tree();
    writeFileSync(join(root, '.github/workflows/extra.yaml'), UNGATED_PUBLISH_WF);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /extra\.yaml/);
  });

  test('a `deploy.yml.bak` beside the workflows is NOT a workflow', () => {
    // Pins the extension filter in the other direction. An editor backup or a
    // merge leftover in that directory is not something GitHub runs, and
    // failing the build over one would be a red with no lane behind it.
    const root = tree();
    writeFileSync(join(root, '.github/workflows/deploy.yml.bak'), UNGATED_PUBLISH_WF);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /deploy\.yml\.bak/);
  });
});

describe('assert-release-provenance — the publish classifier, pinned condition by condition', () => {
  test('a wrangler-action `with:` block ends at the NEXT step, not at the next `command:`', () => {
    // Pins the `if (/^\s*-\s/.test(t)) break;` scan bound. Without it the search
    // for this step's `command:` walks on into the FOLLOWING step and adopts its
    // value — here a `--dry-run`, which would exonerate a wrangler-action step
    // that has no `command:` of its own and therefore deploys by default.
    const wf =
      'name: W\non:\n  workflow_dispatch:\njobs:\n  worker:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      `${GATE_STEP}\n` +
      '      - uses: cloudflare/wrangler-action@abc\n        with:\n          apiToken: x\n' +
      '      - uses: other/action@v1\n        with:\n          command: deploy --dry-run\n';
    const root = tree();
    writeFileSync(join(root, '.github/workflows/action.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /performs a Cloudflare deploy action at :\d+ and never calls/);
  });

  // ── A THIRD DELETION, and this one was found by trying to pin it ──────────
  // `!p.viaCommand &&` in the action pass. The fixture written to hold it — a
  // `command:` value spelling the action's own name, the only input that can
  // make a `viaCommand` pattern match a synthesized command — turned out to be
  // matched by the classifier's own entry test as a SECOND wrangler-action
  // step, pushed as the default deploy at the same line with the same label.
  // Output identical with the conjunct and without it, measured. Unfalsifiable,
  // so deleted rather than decorated; the proof lives beside the code that
  // went, and the partition is held by the generic pass's
  // `if (p.viaCommand) continue;`, which the sweep turned RED.

  test('a `command: pages deploy` is ONE publish, reported as the action', () => {
    // Pins `if (consumed.has(l.n)) continue;`. The command line the action pass
    // already classified also matches the generic `pages\s+deploy` pattern, so
    // without the skip the same deploy is counted twice and the LAST publish —
    // which is what the marker-order rule measures against — becomes the
    // duplicate rather than the real one.
    const wf =
      'name: W\non:\n  workflow_dispatch:\njobs:\n  worker:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      '      - uses: cloudflare/wrangler-action@abc\n        with:\n          command: pages deploy build/web\n';
    const root = tree();
    writeFileSync(join(root, '.github/workflows/action.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /performs a Cloudflare deploy action at :\d+ and never calls/);
  });

  test('publishes are ordered by LINE, so the marker-order rule sees the real last one', () => {
    // Pins `found.sort((a, b) => a.n - b.n)`. The action pass runs before the
    // generic pass, so unsorted the list is in PASS order, not FILE order: the
    // `gh release create` on the early line lands last, and a marker written
    // between the two publishes is measured against the wrong one and passes.
    const wf =
      'name: M\non:\n  push:\njobs:\n  ship:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      `${GATE_STEP}\n` +
      '      - run: gh release create v1 app.zip\n' +
      `${MARKER_STEP}\n` +
      '      - uses: cloudflare/wrangler-action@abc\n        with:\n          command: deploy\n';
    const root = tree();
    writeFileSync(join(root, '.github/workflows/mixed.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /records the deployment at :\d+, BEFORE its last publish at :\d+/);
  });
});

describe('assert-release-provenance — the gate walk, pinned condition by condition', () => {
  test('a FOLDED `run: >` gate call is seen — the call is read from logical lines', () => {
    // Pins `has()` reading `job.logical` rather than `job.lines`. Split across
    // fold continuations, `node` and the script path sit on different PHYSICAL
    // lines and a raw-line read matches neither — turning a correctly gated
    // build into a false red. The folded BUILD case is pinned above; this is
    // the same fold on the gate side, which nothing held.
    const wf =
      'name: Fg\non:\n  workflow_dispatch:\njobs:\n  gate:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      '      - run: >\n          node\n          tooling/ci/assert-gate-passed.mjs\n          ${{ github.sha }}\n' +
      '  build:\n    runs-on: ubuntu-24.04\n    needs: gate\n    steps:\n      - run: flutter build web --release\n';
    const root = tree();
    writeFileSync(join(root, '.github/workflows/folded-gate.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /folded-gate\.yml/);
  });

  test('a `needs:` cycle terminates instead of recursing forever', () => {
    // Pins `if (path.has(j.name)) return;`. GitHub refuses to run a cycle, but
    // a guard that meets one in a half-edited file must still answer; without
    // the guard the walk recurses until the stack dies and the run reports a
    // crash where it should report an ungated build.
    const wf =
      'name: Cy\non:\n  workflow_dispatch:\njobs:\n' +
      '  a:\n    runs-on: ubuntu-24.04\n    needs: b\n    steps:\n      - run: flutter build apk\n' +
      '  b:\n    runs-on: ubuntu-24.04\n    needs: a\n    steps:\n      - run: echo hi\n';
    const root = tree();
    writeFileSync(join(root, '.github/workflows/cycle.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /cycle\.yml: job "a" runs 1 release build\(s\)/);
    assert.match(out, /neither it nor any job it `needs` calls/);
    assert.doesNotMatch(out, /Maximum call stack/);
  });

  test("a job's OWN gate call is the one its ordering is judged by, even when it also needs a gate job", () => {
    // Pins `else if (!clean)` — first credit wins. The build job calls the gate
    // AFTER building AND declares `needs: gate`; if the needed job's call
    // overwrote the credit, the same-job ordering test would compare a
    // DIFFERENT job's line number, find no same-job match, and let a gate
    // consulted after the artifact exists pass.
    const wf =
      'name: Own\non:\n  workflow_dispatch:\njobs:\n' +
      '  gate:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      `${GATE_STEP}\n` +
      '  build:\n    runs-on: ubuntu-24.04\n    needs: gate\n    steps:\n' +
      `${BUILD_STEP}\n${GATE_STEP}\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/own.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /AFTER its first release build/);
  });

  test('a disarming `if:` stays disarming further down the needs path — mutation A1, two hops', () => {
    // Pins `blockedBy ?? disarmed`. The `always()` sits on the BUILD job and the
    // gate is two edges away through an intermediate job that carries no `if:`
    // of its own. Without the carry-forward the intermediate's clean `null`
    // replaces the disarmed marker and the gate is credited in full — the exact
    // edge GitHub's semantics have already broken. The one-hop form is pinned
    // above; the carry is what nothing held.
    const wf =
      'name: Two\non:\n  workflow_dispatch:\njobs:\n' +
      '  gate:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      `${GATE_STEP}\n` +
      '  mid:\n    runs-on: ubuntu-24.04\n    needs: gate\n    steps:\n      - run: echo mid\n' +
      '  build:\n    runs-on: ubuntu-24.04\n    if: always()\n    needs: mid\n    steps:\n' +
      `${BUILD_STEP}\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/twohop.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /is neutralized: job "build" has a job-level `if:` at :\d+ containing `always\(\)`\/`failure\(\)`/);
  });
});

describe('assert-release-provenance — limb 1 and limb 2 order only within a job', () => {
  test('limb 1: a gate job declared LATER in the file is not "after the build"', () => {
    // Pins `gateJob.name === job.name &&` in limb 1. Job order in a YAML file is
    // not run order — `needs:` is — so comparing line numbers across two jobs
    // false-reds every workflow that happens to write its gate job last.
    const wf =
      'name: Late\non:\n  workflow_dispatch:\njobs:\n' +
      '  build:\n    runs-on: ubuntu-24.04\n    needs: gate\n    steps:\n' +
      `${BUILD_STEP}\n` +
      '  gate:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      `${GATE_STEP}\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/late.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /late\.yml/);
  });

  test('limb 2: a gate job declared LATER in the file is not "after the publish"', () => {
    // Pins the same conjunct in limb 2, which is a separate line of code and
    // was separately unheld.
    const wf =
      'name: LateP\non:\n  push:\njobs:\n' +
      '  ship:\n    runs-on: ubuntu-24.04\n    needs: gate\n    steps:\n' +
      `${DEPLOY_STEP}\n${MARKER_STEP}\n` +
      '  gate:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      `${GATE_STEP}\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/latep.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /latep\.yml/);
  });

  test('limb 2 NAMES the line that disarmed the edge instead of claiming no gate exists', () => {
    // Pins limb 2's `if (refused.length > 0)` branch. A publish-only job with an
    // `always()` on it has a `needs: gate` edge that enforces nothing; the other
    // branch would report "without any assert-gate-passed.mjs call", which is
    // false — the call is right there — and sends the reader looking for a
    // missing step instead of at the `if:` that neutered it.
    const wf =
      'name: G11\non:\n  push:\njobs:\n' +
      '  gate:\n    runs-on: ubuntu-24.04\n    steps:\n' +
      `${GATE_STEP}\n` +
      '  ship:\n    runs-on: ubuntu-24.04\n    if: always()\n    needs: gate\n    steps:\n' +
      `${DEPLOY_STEP}\n${MARKER_STEP}\n`;
    const root = tree();
    writeFileSync(join(root, '.github/workflows/g11.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /performs a Cloudflare deploy at :\d+, and its only path to/);
    assert.match(out, /is neutralized/);
  });
});

describe('assert-release-provenance — limb 3 fires only where limbs 1 and 2 do not', () => {
  test('a served lane whose job BUILDS release is limb 1\'s, and limb 3 stays quiet', () => {
    // Pins `!buildsRelease`. Without it the same ungated job draws two failures
    // that name two different rules for one fault, and the served-lane message
    // — which exists for lanes that neither build nor publish — stops meaning
    // what it says.
    const inert = `name: Ship\non:\n  push:\njobs:\n  deploy:\n    runs-on: ubuntu-24.04\n    steps:\n${BUILD_STEP}\n`;
    const root = tree({ servedLane: '.github/workflows/inert.yml' });
    writeFileSync(join(root, '.github/workflows/inert.yml'), inert);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /neither it nor any job it `needs` calls/);
    assert.doesNotMatch(out, /is the lane for a SERVED channel/);
  });

  test('a served lane whose job PUBLISHES is limb 2\'s, and limb 3 stays quiet', () => {
    // Pins `job.publishes.length === 0`. Same reasoning as above on the publish
    // side — and this is the shape the real tree has, deploy-web.yml being both
    // the served lane and a publishing job.
    const { code, out } = run(tree({ deploy: deployWorkflow({ gate: false }) }));
    assert.equal(code, 1, out);
    assert.match(out, /without any `tooling\/ci\/assert-gate-passed\.mjs` call/);
    assert.doesNotMatch(out, /is the lane for a SERVED channel/);
  });
});

describe('assert-release-provenance — the register row filter', () => {
  test('a channel that is not SERVED does not make its workflow a served lane', () => {
    // Pins `c.served === true`. A deferred channel may name a lane long before
    // the lane is built — seven of this register's rows do — and holding an
    // unserved lane to limb 3 would red the build for a channel that ships
    // nothing.
    const inert = 'name: Later\non:\n  push:\njobs:\n  someday:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo not yet\n';
    const root = tree();
    writeFileSync(join(root, '.github/workflows/later.yml'), inert);
    writeFileSync(
      join(root, 'tooling/channel-register.json'),
      registerWith({ id: 'snap', served: false, lane: { workflow: '.github/workflows/later.yml', job: 'someday' } }),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /later\.yml/);
  });

  test('a served channel with NO lane at all is skipped, not a crash', () => {
    // Pins `c.lane &&`. A row can be served before its lane is recorded; without
    // the conjunct the next term reads `.workflow` off undefined and the whole
    // guard dies on a register the guard is supposed to be reading.
    const root = tree();
    writeFileSync(join(root, 'tooling/channel-register.json'), registerWith({ id: 'appimage', served: true }));
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /TypeError/);
  });

  test('a lane whose `workflow` is not a string never enters the served set', () => {
    // Pins `typeof c.lane.workflow === 'string'`. The set is compared against
    // `wf.rel`, so a number or a list can never match one — it can only be
    // carried into the printed census as a lane this guard claims to be
    // watching. The census is the observable, so the census is the assertion.
    const root = tree();
    writeFileSync(
      join(root, 'tooling/channel-register.json'),
      registerWith({ id: 'msix', served: true, lane: { workflow: 4242, job: 'x' } }),
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /4242/);
  });

  test('a register that is not valid JSON says so, and does not merely go quiet', () => {
    // Pins the `catch` arm. Without it an unparseable register produces only the
    // downstream "declares no SERVED channel" line, which reads as a register
    // that says nothing rather than a register nothing could read — a different
    // fault with a different fix.
    const root = tree();
    writeFileSync(join(root, 'tooling/channel-register.json'), '{ "channels": [ oops');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /is not valid JSON/);
  });
});

describe('assert-release-provenance — an `ok` line may not assert what the run refuted', () => {
  // 🔴 FOUND BY THIS SWEEP, IN THE GUARD'S OUTPUT RATHER THAN ITS LOGIC. limb
  // 4's success line printed "each declares an `environment:` and its script
  // performs a run-time protection-rules read" UNCONDITIONALLY — four lines
  // above the FAIL line saying that very job declares none. Both directions are
  // held here, because a line that is honest only when it passes is the half
  // that was already true.
  test('the clean run SAYS the assertion held', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /each declares an `environment:` and its script performs a run-time protection-rules read/);
  });

  test('the failing run does NOT, and counts the failures instead', () => {
    const { code, out } = run(tree({ submit: submitWorkflow({ environment: null }) }));
    assert.equal(code, 1, out);
    assert.doesNotMatch(out, /each declares an `environment:`/);
    assert.match(out, /1 of those assertions FAILED — see the FAIL line\(s\) below/);
  });

  test('a limb-4 failure is counted by limb 4, not by the run as a whole', () => {
    // The count is limb 4's own, not `problems.length`: a red somewhere else
    // must not make this line disown an assertion that did hold. Here limb 2
    // fails and limb 4 does not.
    const { code, out } = run(tree({ deploy: deployWorkflow({ marker: false }) }));
    assert.equal(code, 1, out);
    assert.match(out, /never calls tooling\/ci\/record-deployment\.mjs/);
    assert.match(out, /each declares an `environment:` and its script performs a run-time protection-rules read/);
  });

  test('a (b)-half failure disowns the line too, not only an (a)-half one', () => {
    // ADDED 2026-08-24. Both existing failing cases above drive `submitProblems`
    // through limb 4 (a) or through limb 2, so the `submitProblems++` inside
    // (b) — the run-time-read half — could be replaced with `void 0` and all 84
    // cases stayed green. That single token is the whole 2026-08-22 repair:
    // without it the `ok` line says "each … performs a run-time
    // protection-rules read" four lines above the FAIL saying this one does not.
    const { code, out } = run(tree({ submitScript: SUBMIT_SCRIPT_BLIND }));
    assert.equal(code, 1, out);
    assert.doesNotMatch(out, /each declares an `environment:`/);
    assert.match(out, /1 of those assertions FAILED — see the FAIL line\(s\) below/);
  });
});

describe('assert-release-provenance — the gate-constituent walk', () => {
  // The credit that lets ci.yml build for release without polling itself is a
  // TRANSITIVE walk of the gate-verdict job's `needs`. The 2026-08-22 sweep
  // found all three of its conditions switchable off with the suite green: the
  // depth of the walk, its tolerance of an edge naming a job that is not there,
  // and its refusal to grant the credit at all when two jobs claim the name.
  const verdict = (needs) =>
    `  verdict:\n    name: ci-gate\n    runs-on: ubuntu-24.04\n    needs: ${needs}\n    if: always()\n    steps:\n      - run: echo aggregate\n`;

  test('the credit reaches a constituent TWO edges away, and survives an edge to a job that is not there', () => {
    // Pins `if (d) stack.push(...d.needs)` in both halves. Stop descending and
    // `deep` — which runs the release build — loses the credit and draws a
    // false red on the one workflow every deploy lane depends on. Drop the `d`
    // test and the `ghost` edge dereferences undefined and kills the guard.
    const wf =
      'name: CI\non:\n  push:\njobs:\n' +
      '  deep:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: flutter build web --pwa-strategy=none\n' +
      '  probe:\n    runs-on: ubuntu-24.04\n    needs: [deep]\n    steps:\n      - run: echo probe\n' +
      verdict('[probe, ghost]');
    const root = tree();
    writeFileSync(join(root, '.github/workflows/deepgate.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /deepgate\.yml/);
  });

  test('a cycle among the gate constituents terminates', () => {
    // Pins `if (seen.has(n)) continue;`. This walk is a `while (stack.length)`
    // loop, not a recursion, so a cycle among the verdict's needs does not
    // overflow — it SPINS, and a guard that never returns is a CI job that
    // never returns. Under the mutation this case does not fail, it hangs;
    // measured with a cap, which is how a hang is reported.
    const wf =
      'name: CI\non:\n  push:\njobs:\n' +
      '  probe:\n    runs-on: ubuntu-24.04\n    needs: [helper]\n    steps:\n      - run: flutter build web --pwa-strategy=none\n' +
      '  helper:\n    runs-on: ubuntu-24.04\n    needs: [probe]\n    steps:\n      - run: echo helper\n' +
      verdict('[probe]');
    const root = tree();
    writeFileSync(join(root, '.github/workflows/cyclegate.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /cyclegate\.yml/);
  });

  test('TWO jobs claiming the gate check name is a problem, said out loud', () => {
    // Pins `else if (gateVerdictJobs.length > 1)`. assert-gate-passed.mjs polls
    // that check BY NAME, so a second claimant can hand every deploy lane the
    // wrong verdict. Without the branch the credit is silently withdrawn — the
    // `if (…length === 1)` above simply does not fire — and the reason is never
    // printed, which turns a naming collision into an unexplained false red
    // somewhere else in the tree.
    const wf =
      'name: Twice\non:\n  push:\njobs:\n' +
      '  a:\n    name: ci-gate\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo a\n' +
      '  b:\n    name: ci-gate\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo b\n';
    const root = tree();
    writeFileSync(join(root, '.github/workflows/twice.yml'), wf);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /2 jobs produce a check run named "ci-gate"/);
    assert.match(out, /polls that check BY NAME/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE FOUR NUMBERS, RE-TAKEN 2026-08-24 AFTER THE LAST CODE EDIT TO EITHER
// FILE. They are listed here and nowhere else, because the last time they were
// written in two places one place went stale within the session — and then the
// block that said so went stale itself: every figure it carried was two sweeps
// and eleven cases out of date by the time anyone read it, and it was the only
// dated block in this file with no stale marker on it. That is the failure this
// heading exists to prevent, so it has now happened here once.
// NOTHING AFTER THIS MEASUREMENT CAN MOVE THESE FOUR: the only edits that
// follow it are comment lines, which `grep -c "^  test("` cannot match and
// which assert-guard-coverage strips before it counts.
//     `node --test tooling/ci/test/release-provenance.test.mjs`
//         → EXIT 0, tests 114, pass 114, fail 0
//     cases in the limb-4 suite ('a --submit job is gated on an environment')
//         → 43
//     `grep -c "^  test(" tooling/ci/test/release-provenance.test.mjs`
//         → 108   (lower than 114: TWO `for (const form of …)` loops declare
//                 one `test(` each and run three cases each, 108 + 6 = 114.
//                 The 2026-08-22 note said THREE such loops; its own
//                 78 + 6 = 84 needed two, and `grep -n "for (const form of"`
//                 finds two. A number can be right while the sentence
//                 explaining it is wrong, and both get copied forward.)
//     coverage-manifest.json's ROW FOR THIS FILE
//         → 99, AND THAT ROW IS A FLOOR, NOT A DESCRIPTION OF THIS FILE.
//           assert-guard-coverage counts `^\s*(test|it)\s*\(` over comment-
//           stripped text, which on this file now reads 110: the 108 above
//           plus the two FOUR-space declarations inside those loops, which the
//           `^  test(` grep does not see. 110 > 99, and the ratchet's rule for
//           a rise is "rewrite the manifest, print, PASS" — so CI is green and
//           the row updates itself on the next run of that guard.
//           I did NOT run it. The manifest is shared with every test file in
//           the tree and other agents are writing to it in this same session,
//           so the row it would land on is not a number I could honestly
//           report as mine. NEVER hand-edited either way.
// FOUR numbers, ONE file, and no two of them equal: 114 ran, 108 declared at
// two spaces, 110 counted by the ratchet, 99 recorded. Which one a sentence
// means still has to be said, every time.
//
// The guard's own run on the real tree, same session, after the same last edit:
//     node tooling/ci/assert-release-provenance.mjs  → EXIT 0
//     ok  11 workflow file(s), 43 job(s); 11 build for release, 4 publish
//     ok  2 job(s) invoke a `--submit` verb; 2 script(s) opened …
//         (tooling/release/submit-play.mjs, tooling/release/submit-snap.mjs)
//     ok  1 served-channel lane(s) from tooling/channel-register.json
// ─────────────────────────────────────────────────────────────────────────────
