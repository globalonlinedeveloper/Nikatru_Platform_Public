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
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  write('.github/workflows/build.yml', build);
  write('.github/workflows/deploy.yml', deploy);
  // The stub carries the real script's `GATE` declaration on purpose: the
  // guard DERIVES the gate check name from assert-gate-passed.mjs (single
  // declaration, [pipeline F-2]) and goes COVERAGE LOST when it cannot.
  if (!omitGateScript) write('tooling/ci/assert-gate-passed.mjs', "const GATE = 'ci-gate'; // stub\n");
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
