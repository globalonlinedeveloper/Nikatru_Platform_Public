// ─────────────────────────────────────────────────────────────────────────────
// release-durable.test.mjs — the recorded failing cases for [pipeline 9]R-4's
// two halves: tooling/ci/assert-release-durable.mjs (the guard) and
// tooling/ci/release-manifest.mjs (the mechanism it holds lanes to).
//
// 🔴 A FIXTURE PASSING IS NOT A GUARD WORKING. Every case below is a fixture,
// and this repository has already shipped a guard whose six fixture tests all
// passed against a version that could not fail (assert-seams-wired.mjs, 2026-07-26).
// So the load-bearing negative test for limb 1 was run against the REAL TREE —
// the `gh release create` step was deleted out of .github/workflows/
// build-platforms.yml, the guard went red naming all three platform jobs, and
// the file was restored and proven byte-identical with `git hash-object`. That
// mutation is recorded in the guard's own header; what is here is the finer
// grain a fixture can reach and a real tree cannot (an `if: false` destination,
// a manifest written for the wrong directory, a comment that merely SAYS
// `gh release create`).
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_NAME,
  BUNDLE_MEMBERS,
  EXTRA_INSTALLABLE,
  installableExtensions,
  laneIsWorkflow,
  expectedReleaseFormats,
  missingReleaseFormats,
  originEnvironments,
  signingPosture,
  renderManifest,
  parseManifest,
  verifyEntries,
  assetFiles,
} from '../release-manifest.mjs';
// ⚠️ NOTHING IS IMPORTED FROM assert-release-durable.mjs, deliberately. That file
// runs its whole scan at module scope (it has no `import.meta.url` direct-invocation
// guard), so importing `conditionTokens` to unit-test it would execute the guard
// against the real repository as a side effect of loading this suite — and a helper
// tested in isolation would then be the SECOND reading of a condition anyway. Every
// case below goes through the spawned guard, which is the reading CI performs.

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-release-durable.mjs');
const MANIFEST_SCRIPT = join(REPO, 'tooling', 'ci', 'release-manifest.mjs');
// release-manifest.mjs imports `listDir` from tree-walk.mjs — every directory
// listing in tooling/ci must, and assert-walks-bounded.mjs enforces it. The
// fixture therefore has to carry BOTH files: copying only the script gave
// `COVERAGE LOST — could not be imported`, which is the guard failing closed
// on a broken fixture rather than on a real defect.
const TREE_WALK = join(REPO, 'tooling', 'ci', 'tree-walk.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-durable-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** The register's own word for "declared, but this identity does not exist yet".
 *  Same field assert-channel-register.mjs's `6d. SIGNING-MATERIAL PINS` reads —
 *  grep that, not "limb 6d"; the string is arbitrary and never matched on. */
const SENTINEL = 'CERT-NOT-PURCHASED-IN-THIS-FIXTURE';
const CONFIGURED_PIN = {
  notYetConfiguredSentinel: SENTINEL,
  sha256: 'a'.repeat(64),
  subject: 'CN=Fixture, O=Fixture',
  asOf: '2026-08-21',
  source: 'invented for this fixture; the real one is transcribed from the issued certificate',
};

/** A register with one direct channel and one store channel — enough for the
 *  format derivation, limb 3 and originEnvironments to have real inputs.
 *  🔴 THE DIRECT ROW CARRIES A CONFIGURED SIGNING PIN, and that is load-bearing
 *  rather than decoration: since originEnvironments gates on `signingPosture`, a
 *  fixture row with no signing block is 'undeclared' and is WITHHELD — so a
 *  fixture without this would have quietly turned every positive case below into
 *  a test of the omission path while still reading as a test of the match path. */
const REGISTER = {
  channels: [
    {
      id: 'web',
      kind: 'web',
      served: true,
      artifactFormats: ['static-bundle'],
      deploymentEnvironment: '{app}-web',
    },
    {
      id: 'android-play',
      kind: 'store',
      served: false,
      artifactFormats: ['.aab'],
      deploymentEnvironment: '{app}-android-play',
    },
    {
      id: 'windows-direct',
      kind: 'direct',
      served: false,
      artifactFormats: ['.msix', '.exe'],
      deploymentEnvironment: '{app}-windows-direct',
      signing: { keyKind: 'code-signing-certificate', codeSigningCertificate: { ...CONFIGURED_PIN } },
    },
  ],
};

/** The same register with the direct row's pin pushed back onto its sentinel —
 *  i.e. the state the REAL register is in today. `mutate` reaches the row. */
function registerWith(mutate) {
  const r = JSON.parse(JSON.stringify(REGISTER));
  mutate(r.channels.find((c) => c.id === 'windows-direct'));
  return r;
}

/** Every fixture root carries the real release-manifest.mjs, because the guard
 *  reads MANIFEST_NAME and the extension derivation OUT of it — that single
 *  declaration is one of the guard's REQUIRED_COVERAGE identities, so a fixture
 *  without it is testing a different guard. */
function fixture({ workflows = {}, register = REGISTER, withManifestScript = true } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  if (register !== null) writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify(register, null, 2));
  if (withManifestScript) copyFileSync(MANIFEST_SCRIPT, join(root, 'tooling', 'ci', 'release-manifest.mjs'));
  if (withManifestScript) copyFileSync(TREE_WALK, join(root, 'tooling', 'ci', 'tree-walk.mjs'));
  for (const [name, body] of Object.entries(workflows)) writeFileSync(join(root, '.github', 'workflows', name), body);
  return root;
}

const run = (root, ...flags) => {
  const r = spawnSync(process.execPath, [GUARD, root, ...flags], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

// 🔴 `stdout` AND `stderr` ARE RETURNED SEPARATELY, NOT ONLY CONCATENATED.
// build-platforms.yml:1313-1315 runs `for environment in $(… --emit-environments …)`,
// so STDOUT is a word list fed straight to record-deployment.mjs and stderr is
// not. A test asserting on `out` alone cannot tell an environment name from an
// explanation, and the omission reason this increment adds would pass such a
// test while being recorded as a deployment.
const cli = (args) => {
  const r = spawnSync(process.execPath, [MANIFEST_SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout, stderr: r.stderr };
};

// ── workflow bodies ──────────────────────────────────────────────────────────
const UPLOAD = `      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: subly-linux
          path: |
            apps/subly/build/app/outputs/flutter-apk/*.apk
            apps/subly/build/linux/x64/release/bundle
          retention-days: 7
`;

const PUBLISH_STEPS = `      - name: Write the manifest
        run: node tooling/ci/release-manifest.mjs --write dist --app subly --tag subly-v1 --sha 93aee1d
      - name: Verify it
        run: node tooling/ci/release-manifest.mjs --verify dist
      - name: Publish
        run: gh release create "$TAG" $(node tooling/ci/release-manifest.mjs --emit-assets dist)
`;

/** A release lane: tag trigger, a build job that uploads, a release job
 *  downstream of it that publishes. The shape the real build-platforms.yml has. */
const lane = ({ trigger = "  push:\n    tags: ['*-v*']\n", upload = UPLOAD, publish = PUBLISH_STEPS, releaseJob = true, jobIf = '' } = {}) =>
  `name: Build
on:
  workflow_dispatch:
${trigger}jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
${upload}${
    releaseJob
      ? `  release:
    runs-on: ubuntu-24.04
    needs: build
${jobIf}    steps:
${publish}`
      : ''
  }`;

describe('assert-release-durable.mjs — limb 1 (a release lane cannot end at upload-artifact)', () => {
  test('a release lane whose upload is followed downstream by a durable publish: ok', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane() } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 job\(s\) publish durably/);
  });

  test('THE RECORDED FAILING CASE — the release job is gone and the .apk expires with the run', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane({ releaseJob: false }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /job "build" uploads an installable artifact/);
    assert.match(r.out, /NOTHING in it or downstream of it publishes to a durable destination/);
    assert.match(r.out, /triggers on `push: tags:`/);
  });

  test('the durable step must be DOWNSTREAM — an upstream publish cannot ship an artifact that does not exist yet', () => {
    // `release` no longer `needs: build`, so nothing connects the two.
    const body = lane().replace('    needs: build\n', '');
    const r = run(fixture({ workflows: { 'build.yml': body } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NOTHING in it or downstream of it publishes/);
  });

  test('a durable destination that can never run is no destination', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane({ jobIf: '' }).replace('      - name: Publish\n', '      - name: Publish\n        if: false\n') } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /step-level `if:` is the literal `false`/);
  });

  test('A COMMENT SAYING `gh release create` IS NOT A PUBLISH', () => {
    const commented = lane({
      publish: `      - name: Not a publish
        # gh release create "$TAG" — this is prose about a step, not the step
        run: echo nothing
`,
    });
    const r = run(fixture({ workflows: { 'build.yml': commented } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NOTHING in it or downstream of it publishes/);
  });

  test('a DISPATCH-ONLY lane is a build proof, printed and not failed', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane({ trigger: '', releaseJob: false }) } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /NO release tag trigger, so its uploads are build PROOFS/);
  });

  test('`tags-ignore:` is an exclusion, not a release trigger', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane({ trigger: "  push:\n    tags-ignore: ['v*']\n", releaseJob: false }) } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /NO release tag trigger/);
  });

  test('a desktop bundle DIRECTORY under build/ is installable even with no file extension', () => {
    const dirOnly = `      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: subly-windows
          path: apps/subly/build/windows/x64/runner/Release
`;
    const r = run(fixture({ workflows: { 'build.yml': lane({ upload: dirOnly, releaseJob: false }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /apps\/subly\/build\/windows\/x64\/runner\/Release/);
  });

  test('a SCREENSHOTS upload is a listing asset, not an installable — no false red', () => {
    const shots = `      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: shots
          path: apps/subly/screenshots/
`;
    // Paired with a real installable elsewhere so the COVERAGE-LOST floor is met.
    const r = run(fixture({ workflows: { 'shots.yml': lane({ upload: shots, releaseJob: false }), 'build.yml': lane() } }));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /screenshots/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE DEAD-DESTINATION CLAUSE — every case below was run against the version
// of this guard that only knew the literal `false`, and the three never-true
// conditions ALL EXITED 0. That measurement is the reason this block exists.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-release-durable.mjs — a publish gated on something that can never be true', () => {
  const publishGatedOn = (cond) => PUBLISH_STEPS.replace('      - name: Publish\n', `      - name: Publish\n        if: ${cond}\n`);
  const gated = (cond) => run(fixture({ workflows: { 'build.yml': lane({ publish: publishGatedOn(cond) }) } }));

  test('THE CANONICAL CONDITION passes — this is the live release lane and it must not go red', () => {
    const r = gated("github.ref_type == 'tag'");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 on the canonical/);
  });

  test('the canonical condition wrapped in `${{ }}` is the SAME condition — no false red on a legal spelling', () => {
    const r = gated('"${{ github.ref_type == \'tag\' }}"');
    assert.equal(r.code, 0, r.out);
  });

  test('the canonical condition with no spaces around `==` is the same condition', () => {
    const r = gated("github.ref_type=='tag'");
    assert.equal(r.code, 0, r.out);
  });

  test('the canonical condition with DOUBLE quotes round the tag is the same condition', () => {
    const r = gated('github.ref_type == "tag"');
    assert.equal(r.code, 0, r.out);
  });

  test('`if: false` is still caught, and still says so in the words it always did', () => {
    const r = gated('false');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /step-level `if:` is the literal `false`/);
  });

  test('THE RECORDED FAILING CASE — a never-true CONJUNCTION exited 0 before this repair', () => {
    // `github.run_number` is a positive integer on every run that has ever
    // existed, so `< 0` is a publish that can never happen — written to look
    // exactly like the real thing in a diff. The old clause matched `^false$`
    // and this walked straight past it.
    const r = gated("github.ref_type == 'tag' && github.run_number < 0");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /not the canonical tag-publish condition/);
    assert.match(r.out, /github\.run_number < 0/, 'the failure must QUOTE the condition, or the fix is a guessing game');
  });

  test('an event name nothing emits is caught the same way', () => {
    const r = gated("github.event_name == 'never_a_real_event'");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never_a_real_event/);
  });

  test('the failure tells the reader where a LEGITIMATE new condition goes', () => {
    // A guard whose fix is not obvious is a guard people disable.
    const r = gated("github.ref_name == 'main'");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /CANONICAL_PUBLISH_IF/);
  });

  test('a publish with NO condition at all is live — the clause must not invent a requirement', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane() } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0 of them conditional/);
  });
});

describe('assert-release-durable.mjs — limb 4 (an upload path that defeats if-no-files-found)', () => {
  // The shape: one glob that can legally match nothing, unioned with a directory
  // that always exists. `if-no-files-found: error` asks about the UNION.
  const MIXED = `      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: subly-windows
          path: |
            apps/subly/build/windows/x64/runner/Release
            apps/subly/build/windows/msix/*.msix
          if-no-files-found: error
`;
  const GLOBS_ONLY = `      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: subly-android
          path: |
            apps/subly/build/app/outputs/flutter-apk/*.apk
            apps/subly/build/app/outputs/bundle/release/*.aab
          if-no-files-found: error
`;

  test('mixed paths are a WARNING this increment — exit unaffected, and the reason is printed', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane({ upload: MIXED }) } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /mixes an extension glob/);
    assert.match(r.out, /\*\.msix/);
    assert.match(r.out, /WARNING for this increment only/);
  });

  test('THE RECORDED FAILING CASE — the same tree under `--fail-on-mixed-upload-paths` is RED', () => {
    // An assertion that cannot fail is worse than none, so the limb ships with
    // the switch that proves it can. The flip to unconditional is the next
    // increment, once build-platforms.yml's uploads are split.
    const r = run(fixture({ workflows: { 'build.yml': lane({ upload: MIXED }) } }), '--fail-on-mixed-upload-paths');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL .*mixes an extension glob/);
  });

  test('a block of ONLY globs is fine — an empty union fails the step, which is the whole point', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane({ upload: GLOBS_ONLY }) } }), '--fail-on-mixed-upload-paths');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /limb 4 — no upload step mixes/);
  });

  test('a block of ONLY directories is fine for the same reason', () => {
    const dirsOnly = `      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: subly-desktop
          path: |
            apps/subly/build/windows/x64/runner/Release
            apps/subly/build/linux/x64/release/bundle
          if-no-files-found: error
`;
    const r = run(fixture({ workflows: { 'build.yml': lane({ upload: dirsOnly }) } }), '--fail-on-mixed-upload-paths');
    assert.equal(r.code, 0, r.out);
  });

  test('the flag is not mistaken for the repository root', () => {
    // A flag taken as a path resolves to a directory that does not exist, and
    // every derivation below it then runs against nothing — which is a guard
    // that reports on an empty tree rather than on the one it was pointed at.
    const r = run(fixture({ workflows: { 'build.yml': lane({ upload: GLOBS_ONLY }) } }), '--fail-on-mixed-upload-paths');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /REQUIRED_COVERAGE/);
    assert.match(r.out, /1 workflow\(s\)/, 'it must have read the fixture, not an empty directory');
  });
});

describe('assert-release-durable.mjs — limb 2 (the integrity record)', () => {
  const publishOnly = `      - name: Publish
        run: gh release create "$TAG" dist/*
`;

  test('a publish with no manifest at all fails', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane({ publish: publishOnly }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never runs `tooling\/ci\/release-manifest\.mjs --write`/);
    assert.match(r.out, new RegExp(`published without ${MANIFEST_NAME}`));
  });

  test('`--write` without `--verify` is a claim, not a record', () => {
    const noVerify = PUBLISH_STEPS.replace(/      - name: Verify it\n.*\n/, '');
    const r = run(fixture({ workflows: { 'build.yml': lane({ publish: noVerify }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never runs `--verify`/);
    assert.match(r.out, /naming EVERY asset/);
  });

  test('writing one directory and verifying another proves nothing about either', () => {
    const mismatched = PUBLISH_STEPS.replace('--verify dist', '--verify staging');
    const r = run(fixture({ workflows: { 'build.yml': lane({ publish: mismatched }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /writes the manifest for `dist` and verifies `staging`/);
  });

  test('publishing from a directory the manifest does not describe', () => {
    const elsewhere = PUBLISH_STEPS.replace('gh release create "$TAG" $(node tooling/ci/release-manifest.mjs --emit-assets dist)', 'gh release create "$TAG" out/subly.msix');
    const r = run(fixture({ workflows: { 'build.yml': lane({ publish: elsewhere }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /manifests `dist` and its publish command never mentions it/);
  });

  test('a manifest written AFTER the publish describes something already downloadable', () => {
    const late = `      - name: Publish
        run: gh release create "$TAG" dist/subly.apk
      - name: Write the manifest
        run: node tooling/ci/release-manifest.mjs --write dist --app subly --tag subly-v1 --sha 93aee1d
      - name: Verify it
        run: node tooling/ci/release-manifest.mjs --verify dist
`;
    const r = run(fixture({ workflows: { 'build.yml': lane({ publish: late }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /writes the manifest at :\d+, AFTER its first publish/);
    assert.match(r.out, /verifies the manifest at :\d+, AFTER its first publish/);
  });

  test('a `--dry-run` publish is not a publish and is not held to limb 2', () => {
    const dry = `      - name: Not really publishing
        run: gh release create "$TAG" --dry-run dist/subly.apk
`;
    const r = run(fixture({ workflows: { 'build.yml': lane({ publish: dry }) } }));
    // No durable destination at all now, so limb 1 fires — but limb 2 must not,
    // because a dry run has nothing to checksum.
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /--write/);
  });
});

describe('assert-release-durable.mjs — limb 3 (the register supplies "published")', () => {
  test('a SERVED non-web channel whose lane publishes nothing durable fails', () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    register.channels[2].served = true;
    register.channels[2].lane = { workflow: '.github/workflows/build.yml', job: 'build' };
    const r = run(fixture({ register, workflows: { 'build.yml': lane({ releaseJob: false }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /channel "windows-direct" is SERVED and is not the web channel/);
  });

  test('with only `web` served the limb is CORRECTLY empty and says so', () => {
    const r = run(fixture({ workflows: { 'build.yml': lane() } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /CORRECTLY empty rather than accidentally empty/);
  });
});

describe('assert-release-durable.mjs — REQUIRED_COVERAGE', () => {
  test('the installable set grows with the register — a new `.dmg` channel is covered with no edit', () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    register.channels.push({ id: 'macos-direct', kind: 'direct', served: false, artifactFormats: ['.dmg'], deploymentEnvironment: '{app}-macos-direct' });
    const r = run(fixture({ register, workflows: { 'build.yml': lane() } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /REQUIRED_COVERAGE — .*\.dmg/);
  });

  test('COVERAGE LOST when the mechanism it grades lanes against is gone', () => {
    const r = run(fixture({ withManifestScript: false, workflows: { 'build.yml': lane() } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /release-manifest\.mjs does not exist/);
  });

  test('COVERAGE LOST when the register is unreadable', () => {
    const root = fixture({ register: null, workflows: { 'build.yml': lane() } });
    writeFileSync(join(root, 'tooling', 'channel-register.json'), '{ not json');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /not valid JSON/);
  });

  test('COVERAGE LOST when NO installable upload is found — the classifier stopped matching', () => {
    const nothing = lane({
      upload: `      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: logs
          path: logs/
`,
      releaseJob: false,
    });
    const r = run(fixture({ workflows: { 'build.yml': nothing } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /ZERO installable upload steps/);
  });

  test('COVERAGE LOST when a register lane names a job the parse cannot see', () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    register.channels[1].lane = { workflow: '.github/workflows/build.yml', job: 'a_job_nobody_wrote' };
    const r = run(fixture({ register, workflows: { 'build.yml': lane() } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /a_job_nobody_wrote/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// release-manifest.mjs — the mechanism
// ─────────────────────────────────────────────────────────────────────────────
describe('release-manifest.mjs — the derivations', () => {
  test('the installable set is the register plus the DECLARED extras, and .apk is one', () => {
    const exts = installableExtensions(REGISTER);
    assert.ok(exts.has('.aab'));
    assert.ok(exts.has('.msix'));
    assert.ok(exts.has('.apk'), 'the only sideloadable Android artifact must be covered');
    assert.ok(!exts.has('static-bundle'), 'a shape name is not a file extension');
    assert.ok(EXTRA_INSTALLABLE.get('.apk').length > 60, 'an extra without a reason is a hole with a comment');
  });

  test('originEnvironments takes DIRECT channels only, and only when the release carries their format', () => {
    assert.deepEqual(originEnvironments(REGISTER, 'subly', ['subly-v1-subly.msix']).environments, ['subly-windows-direct']);
    // The .aab is carried, but android-play is a STORE row: a GitHub Release is
    // a download origin, never a submission.
    assert.deepEqual(originEnvironments(REGISTER, 'subly', ['subly-v1-app-release.aab']).environments, []);
    // A direct row whose format is absent is not a channel this release served.
    assert.deepEqual(originEnvironments(REGISTER, 'subly', ['subly-v1-notes.txt']).environments, []);
    // ...and none of those three is an OMISSION. A row that never matched is a
    // different fact from a row that matched and was withheld, and the CLI
    // branches on exactly that difference — an unmatched row must not leak into
    // `omitted`, or the fail-closed `die` for "nothing matched" stops firing.
    // ⚠️ THIS BOUND AND THIS `assert.deepEqual` BOTH SURVIVE BEING NARROWED, and
    // both are kept — see section A/C of the ledger above the next describe().
    // Sliced to one element, or weakened to `assert.ok`, this file stayed at
    // EXIT 0 / 86 pass / 0 fail on 2026-08-24: no subject atom is held by this
    // case alone. A wider bound can only ADD a failure, never remove one, so
    // widening is the free direction and it is the one taken.
    for (const names of [['subly-v1-subly.msix'], ['subly-v1-app-release.aab'], ['subly-v1-notes.txt']]) {
      assert.deepEqual(originEnvironments(REGISTER, 'subly', names).omitted, [], names.join());
    }
  });

  test('the manifest round-trips, and its header carries the gated commit', () => {
    const text = renderManifest({
      app: 'subly',
      tag: 'subly-v1.0.0',
      sha: '93aee1d',
      runUrl: 'https://example/run/1',
      entries: [{ name: 'a.apk', hash: 'a'.repeat(64) }],
    });
    const { meta, entries } = parseManifest(text);
    assert.equal(meta.commit, '93aee1d');
    assert.equal(meta.tag, 'subly-v1.0.0');
    assert.equal(meta.app, 'subly');
    assert.deepEqual(entries, [{ name: 'a.apk', hash: 'a'.repeat(64) }]);
    assert.match(text, /^# NIKATRU release manifest/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 9]E11 — a release does not record a deployment through an identity
// that does not exist.
//
// THE DEFECT, MEASURED 2026-08-21 BY RUNNING THE RELEASE JOB'S OWN COMMAND over
// a scratch directory holding two one-line fake files named `…-app-release.aab`
// and `…-subly.msix`:
//     node tooling/ci/release-manifest.mjs --emit-environments <dir> --app subly
//       → EXIT 0, stdout `subly-windows-direct`
// build-platforms.yml:1313-1315 pipes that stdout into record-deployment.mjs, so
// the first tag writes a [10]D-9 record for a channel whose
// `signing.codeSigningCertificate` still reads CODE-SIGNING-CERT-NOT-PURCHASED.
// LATENT rather than live: `git tag` → 0 that day and the step is
// `if: github.ref_type == 'tag'`, so it had never executed once.
//
// ⚠️ THE CASES BELOW ARE FIXTURES AND A FIXTURE PASSING IS NOT A GATE WORKING —
// this file's own header says so. The load-bearing case is therefore the LAST
// one in this block, which runs the CLI against the REAL tooling/channel-register.json
// and asserts the real windows-direct row is withheld today. If somebody fills
// that pin in, that test is the one that says so out loud.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE ATOMS IN *THIS FILE* THAT NO INPUT DISTINGUISHES, LISTED RATHER THAN
// LEFT TO BE FOUND. Four rounds of this sweep were failed by an OMITTED row, and
// each round the omission got finer — a whole `(A || B)`, then a regex treated as
// one condition, then a LOOP BOUND, then a single escaped dot. So on 2026-08-24
// every atom the branch added to BOTH files was mutated ONE AT A TIME in a
// scratch mirror: 83 mutations against release-manifest.mjs and 39 against this
// file, then the whole set re-run after the last edit to either. Every atom
// listed below stayed GREEN alone. Each is kept, and each is kept for a reason
// that is stated, not assumed. Grep the anchor, not the line number.
//
// A. TEST-SIDE LOOP BOUNDS — kept because more iterations can only ADD failures.
//    A bound that ranges wider cannot make a red case green, so narrowing it is
//    the only risky direction and widening it is free. Sliced to their first
//    element, each of these left this file at EXIT 0 / 86 pass / 0 fail:
//      · `for (const names of [['subly-v1-subly.msix'], …]]` (the .omitted === []
//        loop in 'originEnvironments takes DIRECT channels only')
//      · `for (const [label, mutate] of [` in 'a `signing.*` object with no
//        USABLE sentinel' — re-checked PAIRED with the two subject atoms that
//        only that case catches (the `typeof sentinel !== 'string'` and
//        `sentinel.trim() === ''` clauses): both still RED with the loop sliced,
//        so the 2nd and 3rd labels are not carrying either of them.
//    ⚠️ NOT every bound here is in this class. `for (const ch of [` and its
//    `detail.length > 20` are LOAD-BEARING — see the note at that loop.
//
// B. REGEX ATOMS THAT ONLY EVER MATCH MORE — kept because loosening them cannot
//    turn a failing assertion into a passing one for any output this CLI can
//    produce, and they are what keeps the case portable off this machine:
//      · `\r?` in every `split(/\r?\n/)` — node writes `\n`; the `\r?` is there
//        for a console that does not.
//      · `.filter(Boolean)` before `[0]` — after `.trim()` there is no leading
//        blank line to drop. (The `[0]` INDEX is NOT in this class, and it was
//        measured rather than reasoned about: moved to `[1]` at either of the two
//        sites that spell `[0]`, the file goes to 85 pass / 1 fail, because `[1]`
//        is the "no [10]D-9 record" line and not the omission line.)
//        🔴 AND AT THE THIRD SITE — the `[1]` equality added 2026-08-24 in "the
//        omission reason goes to STDERR" — `.filter(Boolean)` IS NOT IN THIS CLASS
//        AT ALL; it is LOAD-BEARING, and dropping it there is 85 pass / 1 fail.
//        release-manifest.mjs prints that line with a leading `\n`, so the raw
//        split puts an empty string at `[1]`. Read this bullet as scoped to the
//        two `[0]` sites, which is what it silently assumed before that index
//        existed.
//      · `omitted {2}` relaxed to `omitted\s+` in the SIX `assert.match` /
//        `assert.doesNotMatch` calls that spell it. (It said FIVE until 2026-08-24.
//        The CLASS claim was right — all six relaxed at once is EXIT 0 / 86 pass /
//        0 fail — and only the number was wrong. Re-take it with a pattern that
//        cannot match the line you are reading — the bare literal now occurs in
//        this bullet too, so a plain count of it returns 7 and not 6:
//        `grep -cE "assert.*omitted \{2\}"` = 6, and `grep -nE` names all six.)
//        ⚠️ ONE member of this family
//        is NOT loose-able: `/all 2 matching direct channel\(s\)/` relaxed to
//        `all \d matching` unpins `all ${omitted.length}` in release-manifest.mjs
//        — measured, that pair goes GREEN. The digit is the assertion.
//      · the `\.` escapes in `/The release holds: README\.md, notes\.txt\./`.
//        Unescaped, `.` matches the same characters here and nothing else.
//
// C. ASSERTIONS THAT ARE REDUNDANT WITH A STRONGER ONE BESIDE THEM — kept
//    because each names a distinct failure in its message, which is what a
//    reader gets when the case breaks. Weakened to `assert.ok(…)` each left the
//    file green, and for every subject atom that ONLY their own case catches the
//    weakened case still went red:
//      · `assert.doesNotMatch(half.detail, /`sha256`/…)` and the
//        `assert.equal(half.detail, …)` beside it (subsumed by each other)
//      (`assert.match(r.stderr, /all 1 matching direct channel\(s\)…/)` stood in
//        this list until 2026-08-24 and is now GONE rather than weakened. The
//        reason given for keeping it — "the whole-line equality above it already
//        holds that line" — was false: that equality holds the OMISSION line, a
//        different line printed by a different `console.error`. This one and the
//        `/no \[10\]D-9 record/` beside it were the ONLY readings of the
//        "no [10]D-9 record" line, and being substring matches they left its tail
//        sentence unheld. Both are replaced by one whole-line equality.)
//      · `assert.deepEqual(r.omitted.map((o) => o.environment), …)` — the `.id`
//        deepEqual above it is the one that is load-bearing (it is the only
//        thing holding `c.id ?? '(unnamed)'`; measured, that pair goes GREEN)
//      · `assert.doesNotMatch(r.out, /\{app\}/)` and `/subly-windows-direct/`
//        relaxed to `/subly/` in the CLI block
//
// D. ONE BRANCH THIS TREE CANNOT REACH TODAY — the `else` of
//    `if (withheld.includes('windows-direct'))`. See the note at that line.
// ─────────────────────────────────────────────────────────────────────────────
describe('release-manifest.mjs — origin channels are gated on signing posture', () => {
  test('signingPosture reads the register\'s own sentinel vocabulary, in all four states', () => {
    // 'pinned' — a pin block with no field on the sentinel.
    assert.equal(signingPosture(REGISTER.channels.find((c) => c.id === 'windows-direct')).state, 'pinned');

    // 'sentinel' — every value field still the placeholder. This is the real
    // register's state on both of its direct rows today.
    assert.equal(
      signingPosture({ signing: { keyKind: 'code-signing-certificate', codeSigningCertificate: { ...CONFIGURED_PIN, sha256: SENTINEL, subject: SENTINEL } } }).state,
      'sentinel',
    );

    // 🔴 'sentinel' ON THE HALF-CONFIGURED BLOCK TOO, and this is the branch the
    // ANY-not-ALL choice exists for: a real thumbprint beside a placeholder
    // subject is the state that packages and ships under the wrong name.
    const half = signingPosture({ signing: { keyKind: 'code-signing-certificate', codeSigningCertificate: { ...CONFIGURED_PIN, subject: SENTINEL } } });
    assert.equal(half.state, 'sentinel');
    assert.match(half.detail, /`subject`/);
    assert.doesNotMatch(half.detail, /`sha256`/, 'the detail must name the fields that are UNFILLED, not every field');

    // 🔴 `v === sentinel` IS STRICT, AND THE STRICTNESS IS ITS OWN ATOM — the
    // `===` was NOT held by anything until 2026-08-24. Relaxed to `v == sentinel`
    // and changed nowhere else, this file stayed EXIT 0 / 86 pass / 0 fail,
    // because no fixture had ever put a NON-STRING value under a signing block.
    // The register is `JSON.parse`d, so an array is a value a human can write,
    // and `['X'] == 'X'` is TRUE by coercion while `['X'] === 'X'` is false — so
    // the two spellings classify the SAME register differently and neither is a
    // widening of the other in the verdict: loose reads the row as still on its
    // sentinel and WITHHOLDS the [10]D-9 row, strict reads the block as
    // configured and RECORDS it. Strict is what ships, so strict is what is
    // asserted here rather than left to the next reader to discover.
    assert.equal(
      signingPosture({
        signing: {
          keyKind: 'code-signing-certificate',
          codeSigningCertificate: { ...CONFIGURED_PIN, subject: [SENTINEL] },
        },
      }).state,
      'pinned',
      'a one-element array is not the sentinel STRING; only `==` would say it is',
    );
    // 🔴 AND THE WHOLE SENTENCE, NOT ONE FIELD NAME OUT OF IT. Measured
    // 2026-08-24: the block name, the quoted sentinel VALUE
    // (`${JSON.stringify(sentinel)}`) and the `k !== 'notYetConfiguredSentinel'`
    // exclusion each survived `if (false)` / redaction at EXIT 0 / 85 pass /
    // 0 fail, because every assertion on a detail was a substring match on one
    // token. The detail is the only thing the CLI prints as the REASON a ledger
    // row was withheld, so an equality here is what makes it a reason and not a
    // label.
    assert.equal(half.detail, `signing.codeSigningCertificate still reads ${JSON.stringify(SENTINEL)} at \`subject\``);

    // 🔴 TWO UNFILLED BLOCKS ARE BOTH NAMED. `unfilled.join('; ')` survived
    // `unfilled.slice(0, 1).join('; ')` on 2026-08-24 (EXIT 0 / 85 pass / 0 fail)
    // — no fixture had ever put two pin blocks on their sentinels at once. The
    // real register's windows-direct row carries SEVEN keys under `signing`, so a
    // second block joining the first is one purchase away, and a detail that
    // stops at the first would send the owner to fill one pin and leave the other.
    const twoUnfilled = signingPosture({
      signing: {
        keyKind: 'code-signing-certificate',
        codeSigningCertificate: { ...CONFIGURED_PIN, sha256: SENTINEL },
        timestampCertificate: { ...CONFIGURED_PIN, subject: SENTINEL },
      },
    });
    assert.equal(twoUnfilled.state, 'sentinel');
    assert.equal(
      twoUnfilled.detail,
      `signing.codeSigningCertificate still reads ${JSON.stringify(SENTINEL)} at \`sha256\`; `
      + `signing.timestampCertificate still reads ${JSON.stringify(SENTINEL)} at \`subject\``,
    );

    // 🔴 THE PINNED DETAIL COUNTS THE BLOCKS IT FOUND. `${pinBlocks}` survived
    // being frozen to a literal `0` on 2026-08-24 at EXIT 0 / 85 pass / 0 fail:
    // the only assertion on a 'pinned' detail was `.length > 20`, which a wrong
    // number satisfies. The count is how a reader tells "one identity, configured"
    // from "several, and all of them read".
    assert.equal(
      signingPosture(REGISTER.channels.find((c) => c.id === 'windows-direct')).detail,
      '1 pinned signing-material block(s), none on a sentinel',
    );
    assert.equal(
      signingPosture({ signing: { keyKind: 'k', a: { ...CONFIGURED_PIN }, b: { ...CONFIGURED_PIN } } }).detail,
      '2 pinned signing-material block(s), none on a sentinel',
    );

    // 'none' — the register's word for a channel that signs nothing of ours.
    assert.equal(signingPosture({ signing: { keyKind: 'none', identity: null } }).state, 'none');

    // 🔴 ...AND THAT `===` IS STRICT, WHICH IS AN ATOM OF ITS OWN. Nothing
    // held it until 2026-08-24: relaxed to `signing.keyKind == 'none'` in
    // release-manifest.mjs and changed nowhere else, this file stayed EXIT 0 /
    // 86 pass / 0 fail, because no fixture had ever put a NON-STRING under
    // `keyKind` and the two operators cannot differ on two strings. The register
    // is `JSON.parse`d, so `"keyKind": ["none"]` is a value a human can write,
    // and `['none'] == 'none'` is TRUE by coercion while `['none'] === 'none'`
    // is false. THE TWO SPELLINGS GIVE THIS ONE ROW OPPOSITE VERDICTS, which is
    // why originEnvironments is asserted here and not the state alone: loose
    // reads it as a channel that signs nothing and RECORDS a [10]D-9 row through
    // a `keyKind` no reader in this repository can interpret; strict reads the
    // posture as unreadable and WITHHOLDS the row. Strict is what ships.
    // (The JSON round-trip below is a DECLARED no-op on this data and holds no
    // verdict: it is there to say out loud that this row is a shape the register
    // FILE can carry, not a JS object only a test can build. Arrays survive it
    // unchanged, so removing it changes no answer here.)
    const arrayKeyKind = JSON.parse(JSON.stringify({
      id: 'array-keykind',
      kind: 'direct',
      deploymentEnvironment: '{app}-array-keykind',
      artifactFormats: ['.msix'],
      signing: { keyKind: ['none'], identity: null },
    }));
    assert.equal(
      signingPosture(arrayKeyKind).state,
      'undeclared',
      'a one-element array is not the STRING "none"; only `==` would say it is',
    );
    const arrayKeyKindOrigin = originEnvironments({ channels: [arrayKeyKind] }, 'subly', ['subly-v1-subly.msix']);
    assert.deepEqual(arrayKeyKindOrigin.environments, [], 'an unreadable keyKind may never reach the ledger');
    assert.deepEqual(arrayKeyKindOrigin.omitted.map((o) => o.id), ['array-keykind']);

    // 'undeclared' — a `signing` block whose every object LACKS a
    // `notYetConfiguredSentinel` (here: no object at all under it); and the
    // no-`signing`-block-whatsoever case. ⚠️ AND READ THAT AS THE LAST ARM OF A
    // CASCADE, NOT AS A STANDALONE DESCRIPTION — measured 2026-08-22, `web`,
    // `windows-store` and `linux-snap` all fit it word for word (two `signing.*`
    // objects apiece, `restoreDrill` and `seam`, neither carrying a sentinel key)
    // and all three classify 'none', because 'none' is tested first. Code order
    // is sentinel → pinned → none → undeclared, and the assertion two lines down
    // reaches 'undeclared' only because its `keyKind` is not `"none"`.
    // ⚠️ NOT "pins nothing", which is what
    // this line said until 2026-08-21 and what release-manifest.mjs's vocabulary
    // note said with it: android-play carries the one fully configured pin in the
    // real register and classifies 'undeclared', because that block has no
    // sentinel key. The case titled "a `signing.*` object with no USABLE
    // sentinel is not a pin block" below covers exactly that shape.
    assert.equal(signingPosture({ signing: { keyKind: 'code-signing-certificate' } }).state, 'undeclared');
    assert.equal(signingPosture({ id: 'x', kind: 'direct' }).state, 'undeclared');

    // Every state carries a detail a human can act on. A withheld ledger row
    // with an empty explanation is the silent omission this gate exists to stop.
    // 🔴 THIS BOUND AND THIS THRESHOLD ARE LOAD-BEARING, WHICH IS WHY THEY ARE
    // NOT IN SECTION A OF THE LEDGER ABOVE. Measured 2026-08-24: they are the
    // ONLY thing holding the `keyKind "none" — this channel signs nothing of
    // ours` detail in release-manifest.mjs. Replacing that literal with a shorter
    // string is red on the shipped file (85 pass / 1 fail); replace it AND slice
    // this loop to its first element and the file goes back to 86 pass / 0 fail;
    // replace it AND relax `> 20` to `>= 0` and it does the same. The 'none' row
    // is the SECOND element of this list, and 20 is above the length of a stub —
    // so narrowing either one silently drops the only reading of that sentence.
    for (const ch of [
      REGISTER.channels.find((c) => c.id === 'windows-direct'),
      { signing: { keyKind: 'none' } },
      { signing: { keyKind: 'code-signing-certificate' } },
      { signing: { keyKind: 'code-signing-certificate', codeSigningCertificate: { ...CONFIGURED_PIN, sha256: SENTINEL, subject: SENTINEL } } },
    ]) {
      assert.ok(signingPosture(ch).detail.length > 20, JSON.stringify(ch));
    }
  });

  // 🔴 THE FOUR WAYS THE `signing` VALUE ITSELF IS UNREADABLE. Added 2026-08-22
  // because the 2026-08-21 sweep that this block's comments cite mutated
  // signingPosture's two compound `if`s AS WHOLES, and a clause-by-clause re-sweep
  // found three of the four clauses on the first one surviving `if (false)` with
  // this file at EXIT 0 / 81 pass / 0 fail: `channel?.`, `signing === null` and
  // `Array.isArray(signing)`. Only `typeof signing !== 'object'` was held (by the
  // no-`signing`-key row above). None of the three is dead — each changes the
  // answer on an input the register can hold — and the array one changes it in the
  // fail-OPEN direction, which is the one that writes a [10]D-9 row for an
  // identity nothing could read. So they are pinned here rather than deleted; the
  // two clauses that genuinely COULD NOT be pinned were deleted instead, and
  // release-manifest.mjs's block guard records which and why.
  test('an UNREADABLE `signing` value is UNDECLARED and withheld — null, an array, and no row at all', () => {
    // `"signing": null` is legal JSON and `typeof null === 'object'`, so without
    // the `signing === null` clause this reaches `Object.entries(null)` and the
    // release job dies with a TypeError instead of withholding a ledger row.
    const unreadable = signingPosture({ id: 'x', kind: 'direct', signing: null });
    assert.equal(unreadable.state, 'undeclared');
    // 🔴 AND THIS BRANCH'S DETAIL IS ITS OWN STRING, WHICH NOTHING HELD UNTIL
    // 2026-08-24. Replacing that literal in release-manifest.mjs with any other
    // text left this file at EXIT 0 / 86 pass / 0 fail: the `state` beside it was
    // pinned and the only sentence a human ever reads was not. The two
    // 'undeclared' details are NOT interchangeable and are repaired by opposite
    // edits — this one says the `signing` VALUE could not be read at all, the one
    // asserted at the bottom of this case says it was read fine and simply
    // carried no pin block. (The four-channel `detail.length > 20` loop below
    // does not reach it: none of those four rows has an unreadable `signing`.)
    assert.equal(unreadable.detail, 'the row declares no readable `signing` block');

    // 🔴 THE ARRAY IS THE DANGEROUS ONE. `typeof [] === 'object'` as well, so
    // without `Array.isArray` the entries below are the array's INDICES, the
    // pin-shaped element at index 0 counts as a pin block, and the row classifies
    // 'pinned' — i.e. a release RECORDS a deployment through a `signing` value no
    // reader in this repository can interpret.
    const arrayRow = {
      id: 'windows-direct',
      kind: 'direct',
      artifactFormats: ['.msix'],
      deploymentEnvironment: '{app}-windows-direct',
      signing: [{ ...CONFIGURED_PIN }],
    };
    assert.equal(signingPosture(arrayRow).state, 'undeclared', 'an array is not a `signing` block');
    const r = originEnvironments({ channels: [arrayRow] }, 'subly', ['subly-v1-subly.msix']);
    assert.deepEqual(r.environments, [], 'an unreadable posture must never reach the ledger');
    assert.equal(r.omitted.length, 1);
    assert.equal(r.omitted[0].state, 'undeclared');

    // `signingPosture` is EXPORTED, so "no row at all" is an input it can be
    // handed; `channel?.signing` is the only thing that makes it an answer rather
    // than a TypeError.
    assert.equal(signingPosture(undefined).state, 'undeclared');
    assert.equal(signingPosture(null).state, 'undeclared');

    // ...and the detail names the keyKind it could not use. `?? null` is what
    // keeps an ABSENT keyKind readable here — without it this line reads
    // "keyKind undefined", which is a JS spelling and not the register's.
    assert.match(signingPosture({ signing: {} }).detail, /keyKind null and no signing-material block/);
  });

  // 🔴 SIX MORE CLAUSES THE 2026-08-21 SWEEP NEVER REACHED, because that sweep
  // stopped at the conditions the signing-posture change ADDED and these are the
  // ones it inherited in the same loop. Each survived `if (false)` with this file
  // at EXIT 0 / 81 pass / 0 fail on 2026-08-22, and none is dead — the register is
  // hand-written JSON and every shape below is one a human produces. The
  // `{app}`-less template is the one that is dangerous rather than merely untidy:
  // `tpl.replace('{app}', app)` is a no-op on it, so the row emits ONE environment
  // name for EVERY app, and [10]D-9 records subly's release against dictoro's row.
  test('a MALFORMED row is skipped, never fatal, and never silently renamed', () => {
    const good = REGISTER.channels.find((c) => c.id === 'windows-direct');
    const malformed = {
      channels: [
        // `null` is legal JSON in an array. `c?.kind` is what makes it a skip.
        null,
        // no `deploymentEnvironment` at all — `typeof tpl !== 'string'`.
        { id: 'no-env', kind: 'direct', artifactFormats: ['.msix'] },
        // a template that forgot `{app}` — `!tpl.includes('{app}')`.
        { id: 'literal-env', kind: 'direct', artifactFormats: ['.msix'], deploymentEnvironment: 'windows-direct' },
        // no `artifactFormats` key — `c.artifactFormats ?? []`.
        { id: 'no-formats', kind: 'direct', deploymentEnvironment: '{app}-no-formats' },
        // non-string entries beside the real one — `typeof f === 'string'`.
        { id: 'junk-formats', kind: 'direct', artifactFormats: [42, null, '.msix'], deploymentEnvironment: '{app}-junk-formats' },
        // 🔴 A FORMAT WITH NO LEADING DOT — `f.startsWith('.')`, which survived
        // `if (false)` with this file at EXIT 0 / 85 pass / 0 fail on 2026-08-24
        // because every fixture format had always begun with one. `static-bundle`
        // is not invented: it is the `web` row's declared artifactFormat in the
        // real register today, so a hand-edit that gives a DIRECT row the same
        // value is a register a human writes. Without the dot filter the match
        // degenerates to "the asset name ends with this word", `keyKind: "none"`
        // makes the row recordable, and the release writes a [10]D-9 row for a
        // channel that declared no file extension at all.
        { id: 'dotless-format', kind: 'direct', artifactFormats: ['static-bundle'], deploymentEnvironment: '{app}-dotless', signing: { keyKind: 'none' } },
        // no `id` — the omission line still has to name something.
        { kind: 'direct', artifactFormats: ['.msix'], deploymentEnvironment: '{app}-unnamed' },
        good,
      ],
    };
    const r = originEnvironments(malformed, 'subly', ['subly-v1-subly.msix', 'subly-v1-static-bundle']);
    // The one well-formed, pinned row still emits. A broken sibling must not cost
    // the release its ledger row, and must not throw the release job either.
    assert.deepEqual(r.environments, ['subly-windows-direct']);
    // Exactly two rows got far enough to be WITHHELD: the junk-formats row (whose
    // one real format matched) and the id-less row. Every other malformed row was
    // skipped before posture was ever asked. `literal-env` appearing here is the
    // `{app}` clause failing open; a bare `undefined` id is the `?? '(unnamed)'`
    // clause failing open.
    assert.deepEqual(r.omitted.map((o) => o.id), ['junk-formats', '(unnamed)']);
    assert.deepEqual(r.omitted.map((o) => o.environment), ['subly-junk-formats', 'subly-unnamed']);

    // A register with no `channels` key, and no register at all, are both empty
    // answers rather than a crash in the middle of a release job.
    assert.deepEqual(originEnvironments({}, 'subly', ['subly-v1-subly.msix']), { environments: [], omitted: [] });
    assert.deepEqual(originEnvironments(undefined, 'subly', ['subly-v1-subly.msix']), { environments: [], omitted: [] });
  });

  // 🔴 THE `new Set(out)` DEDUPE HAD NOTHING HOLDING IT — pinned 2026-08-22 by the
  // clause-by-clause sweep, which measured it surviving `if (false)` with this file
  // EXIT 0 / 81 pass / 0 fail, because no two rows in any fixture or in the real
  // register have ever shared a `deploymentEnvironment`. Losing it means
  // `for environment in $(…)` calls record-deployment.mjs TWICE for one channel —
  // a DUPLICATED [10]D-9 row, not a missing one — and two direct rows for one
  // environment is simply how a channel gets a second artifact format.
  // The two `.toLowerCase()` calls in the same expression were ALREADY held when
  // this case was written (the MIXED fixture's `.AppImage` asset reddens both; that
  // was mutated in the same sweep and measured, not assumed). They are covered here
  // anyway on purpose: that hold is incidental to one fixture's filename casing, and
  // the property — the register's declared extension and the built file's name may
  // disagree in case — deserves a case that says so.
  test('the extension match is case-insensitive BOTH ways, and one environment is recorded once', () => {
    const nosign = { keyKind: 'none' };
    const reg = {
      channels: [
        // format SHOUTED in the register, asset lowercase on disk.
        { id: 'upper-fmt', kind: 'direct', artifactFormats: ['.MSIX'], deploymentEnvironment: '{app}-upper', signing: nosign },
        // format lowercase, asset SHOUTED on disk — which is how several Windows
        // and installer tools name what they emit.
        { id: 'upper-asset', kind: 'direct', artifactFormats: ['.exe'], deploymentEnvironment: '{app}-lower', signing: nosign },
        // two rows, one environment: it must be recorded once.
        { id: 'dup-a', kind: 'direct', artifactFormats: ['.dmg'], deploymentEnvironment: '{app}-dup', signing: nosign },
        { id: 'dup-b', kind: 'direct', artifactFormats: ['.dmg'], deploymentEnvironment: '{app}-dup', signing: nosign },
        // 🔴 THE SECOND DECLARED FORMAT MATCHES AND THE FIRST DOES NOT. The
        // `formats.some(…)` BOUND had nothing holding it — it survived
        // `formats.slice(0, 1).some(…)` on 2026-08-24 with this file at EXIT 0 /
        // 85 pass / 0 fail, because every fixture row that matched matched on its
        // FIRST format. windows-direct really declares `['.msix', '.exe']`, so a
        // release carrying only the .exe is the ordinary shape of this row, and a
        // bound that stops at the first format withholds its ledger row silently.
        { id: 'second-format', kind: 'direct', artifactFormats: ['.msi', '.exe'], deploymentEnvironment: '{app}-second', signing: nosign },
        // 🔴 THE EXTENSION IS A SUFFIX, NEVER A SUBSTRING. `endsWith` relaxed to
        // `includes` survived on 2026-08-24 at EXIT 0 / 85 pass / 0 fail: no
        // fixture asset had ever CARRIED a declared extension anywhere but at its
        // end. A checksum sidecar does exactly that — `…zip.sha256` contains
        // `.zip` and is not the artifact — so under `includes` this row matches a
        // release that ships no .zip at all and the ledger records a channel the
        // release never served.
        { id: 'suffix-only', kind: 'direct', artifactFormats: ['.zip'], deploymentEnvironment: '{app}-zip', signing: nosign },
      ],
    };
    const r = originEnvironments(reg, 'subly', ['subly-v1.msix', 'SUBLY-V1.EXE', 'subly-v1.dmg', 'subly-v1.zip.sha256']);
    assert.deepEqual(r.environments, ['subly-dup', 'subly-lower', 'subly-second', 'subly-upper']);
    assert.deepEqual(r.omitted, []);
  });

  test('--emit-environments without --app REFUSES — `{app}` would resolve to the string "undefined"', () => {
    const root = fixture();
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'subly-v1-subly.msix'), 'msix');
    const r = cli(['--emit-environments', d, '--repo-root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /--emit-environments needs --app/);
    // 🔴 THE HALF THAT MATTERS: nothing may reach stdout. Without the `?? die`,
    // `tpl.replace('{app}', undefined)` yields `undefined-windows-direct` and the
    // release job hands THAT to record-deployment.mjs as a real environment.
    assert.equal(r.stdout.trim(), '');
  });

  test('a direct row on its sentinel is OMITTED — with the reason, never silently', () => {
    const onSentinel = registerWith((row) => {
      row.signing.codeSigningCertificate.sha256 = SENTINEL;
      row.signing.codeSigningCertificate.subject = SENTINEL;
    });
    const { environments, omitted } = originEnvironments(onSentinel, 'subly', ['subly-v1-subly.msix']);
    assert.deepEqual(environments, [], 'a channel whose signing identity does not exist is not a channel this release deployed through');
    assert.equal(omitted.length, 1);
    assert.equal(omitted[0].environment, 'subly-windows-direct');
    assert.equal(omitted[0].state, 'sentinel');
    assert.match(omitted[0].detail, /codeSigningCertificate/);
  });

  test('an UNDECLARED posture is withheld too — an unreadable posture is not a good one', () => {
    const noPin = registerWith((row) => { delete row.signing.codeSigningCertificate; });
    const r = originEnvironments(noPin, 'subly', ['subly-v1-subly.msix']);
    assert.deepEqual(r.environments, []);
    assert.equal(r.omitted[0].state, 'undeclared');

    // ...and `keyKind: "none"` is NOT withheld: there is no identity to be
    // missing. Without this case the gate would be "withhold every direct row",
    // which passes the test above for the wrong reason.
    const keyless = registerWith((row) => { row.signing = { keyKind: 'none', identity: null }; });
    const k = originEnvironments(keyless, 'subly', ['subly-v1-subly.msix']);
    assert.deepEqual(k.environments, ['subly-windows-direct']);
    assert.deepEqual(k.omitted, []);

    // 🔴 AND THROUGH THE CLI THE LINE SAYS *UNDECLARED*, NOT "SENTINEL". The
    // `${o.state.toUpperCase()}` in that line survived being FROZEN to the
    // literal `SENTINEL` on 2026-08-24 with this file at EXIT 0 / 86 pass /
    // 0 fail: every CLI case that read the omission line withheld a row whose
    // state genuinely IS 'sentinel', so a frozen literal read true. Frozen, an
    // undeclared row sends the owner hunting the register for a placeholder
    // VALUE that is not there, when what actually happened is that the block
    // carries no `notYetConfiguredSentinel` KEY at all — the two states are
    // repaired by opposite edits, which is the whole reason the CLI names one.
    // Asserted as the WHOLE line for the same reason the sentinel case is: a
    // substring would be satisfied by any of the four tokens in it.
    const undeclaredRoot = fixture({ register: noPin });
    const ud = join(TMP, `d${seq++}`);
    mkdirSync(ud, { recursive: true });
    writeFileSync(join(ud, 'subly-v1-subly.msix'), 'msix');
    const u = cli(['--emit-environments', ud, '--app', 'subly', '--repo-root', undeclaredRoot]);
    assert.equal(u.code, 0, u.out);
    assert.equal(u.stdout.trim(), '', 'an unreadable posture may not reach the word list either');
    assert.equal(
      u.stderr.trim().split(/\r?\n/).filter(Boolean)[0],
      'omitted  subly-windows-direct — channel "windows-direct" signing posture is UNDECLARED: '
      + 'keyKind "code-signing-certificate" and no signing-material block carrying a `notYetConfiguredSentinel`.',
      u.stderr,
    );
  });

  // 🔴 THE THREE WAYS A `signing.*` OBJECT FAILS TO BE A PIN BLOCK. Added
  // 2026-08-21 because an `if (false)` sweep of EVERY condition in
  // release-manifest.mjs found exactly one survivor — the sentinel-key guard
  //     if (typeof sentinel !== 'string' || sentinel.trim() === '') continue;
  // neutered, this suite stayed EXIT 0 / 0 fail, i.e. nothing in the tree could
  // tell a pin block from any other object hanging off `signing`. Neutered, every
  // object below is counted as a pin, `pinBlocks` goes positive, no field can
  // equal an absent-or-blank sentinel, and the row classifies 'pinned' and IS
  // RECORDED. That is the deleted-sentinel-key hazard release-manifest.mjs's
  // 'undeclared' vocabulary note warns the owner about, arriving as a green run.
  test('a `signing.*` object with no USABLE sentinel is not a pin block — it is UNDECLARED, and withheld', () => {
    for (const [label, mutate] of [
      ['the key deleted — which is how the one configured pin in the real register (android-play) is written', (b) => { delete b.notYetConfiguredSentinel; }],
      ['the key present but not a string', (b) => { b.notYetConfiguredSentinel = true; }],
      ['the key present but blank', (b) => { b.notYetConfiguredSentinel = '   '; }],
    ]) {
      // The block KEEPS its real sha256/subject — this is a FILLED-IN pin whose
      // sentinel line was tidied away, not an empty one.
      const reg = registerWith((row) => mutate(row.signing.codeSigningCertificate));
      assert.equal(signingPosture(reg.channels.find((c) => c.id === 'windows-direct')).state, 'undeclared', label);
      const r = originEnvironments(reg, 'subly', ['subly-v1-subly.msix']);
      assert.deepEqual(r.environments, [], label);
      assert.equal(r.omitted.length, 1, label);
      assert.equal(r.omitted[0].state, 'undeclared', label);
    }
  });

  test('the omission reason goes to STDERR — stdout is a word list the release job expands', () => {
    const root = fixture({
      register: registerWith((row) => {
        row.signing.codeSigningCertificate.sha256 = SENTINEL;
        row.signing.codeSigningCertificate.subject = SENTINEL;
      }),
    });
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'subly-v1-subly.msix'), 'msix');
    const r = cli(['--emit-environments', d, '--app', 'subly', '--repo-root', root]);
    // EXIT 0, not 1: `gh release create` has already run by this point in the
    // release job, so failing here would leave a real published release under a
    // red run. The record is withheld; the release is not.
    assert.equal(r.code, 0, r.out);
    assert.equal(r.stdout.trim(), '', 'nothing may reach stdout — every word there becomes an argument to record-deployment.mjs');
    // 🔴 THE WHOLE OMISSION LINE, NOT A TOKEN OUT OF IT. `/SENTINEL/` stood here
    // until 2026-08-24 and was satisfied by `${o.state.toUpperCase()}` — the word
    // "SENTINEL" the CLI prints for the STATE — not by the register's sentinel
    // string at all. Measured that day: redacting `${o.id}`, redacting `${o.detail}`
    // and freezing `all ${omitted.length}` to a literal each left this file at
    // EXIT 0 / 85 pass / 0 fail. This line is the only place a human is told WHICH
    // channel lost its ledger row and WHY, so it is asserted whole.
    assert.equal(
      r.stderr.trim().split(/\r?\n/).filter(Boolean)[0],
      `omitted  subly-windows-direct — channel "windows-direct" signing posture is SENTINEL: `
      + `signing.codeSigningCertificate still reads ${JSON.stringify(SENTINEL)} at \`sha256\`, \`subject\`.`,
      r.stderr,
    );
    // 🔴 ...AND THE CLOSING LINE WHOLE, FOR THE SAME REASON THE OMISSION LINE
    // IS WHOLE. Two SUBSTRING matches stood here until 2026-08-24 —
    // `/all 1 matching direct channel\(s\) were omitted above/` and
    // `/no \[10\]D-9 record for this release/` — and between them they read the
    // head of this line and its COUNT and nothing else, so its TAIL SENTENCE was
    // unheld: replacing `The assets are published; nothing is recorded as
    // deployed through an identity that does not exist.` in release-manifest.mjs
    // with `MUTANT-TAIL.` alone left this file at EXIT 0 / 86 pass / 0 fail. That
    // sentence is the whole reason EXIT 0 is honest on this path rather than a
    // shrug — it is what tells the reader the ARTIFACTS shipped and only the
    // LEDGER ROW did not. The count keeps its own reading here too: a "1" frozen
    // into the text would read the same on the day two channels are held back.
    // ⚠ `.filter(Boolean)` IS LOAD-BEARING AT THIS INDEX and at no other in this
    // file: release-manifest.mjs prints this line with a leading `\n`, so without
    // the filter `[1]` is the empty string between the two lines.
    assert.equal(
      r.stderr.trim().split(/\r?\n/).filter(Boolean)[1],
      'no [10]D-9 record for this release: all 1 matching direct channel(s) were omitted above.'
      + ' The assets are published; nothing is recorded as deployed through an identity that does not exist.',
      r.stderr,
    );
  });

  test('a CONFIGURED pin still emits — the gate is on posture, not on being a direct row', () => {
    const root = fixture();
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'subly-v1-subly.msix'), 'msix');
    const r = cli(['--emit-environments', d, '--app', 'subly', '--repo-root', root]);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.stdout.trim(), 'subly-windows-direct');
    assert.equal(r.stderr.trim(), '', 'nothing was withheld, so nothing is explained');
  });

  // 🔴 THE MIXED CASE — one direct row emits WHILE another is withheld, in the
  // same run. Added 2026-08-21 after a refutation proved this suite was green
  // against a broken variant: rewriting the omission loop in --emit-environments
  // to
  //     for (const o of (environments.length === 0 ? omitted : []))
  // makes the reasons print ONLY when nothing at all emitted, i.e. silent
  // whenever the release records anything — and the whole file still passed,
  // because every case above has either one emitting row or one withheld row and
  // never both. That mutation is the exact silent-omission failure the header of
  // originEnvironments says this half exists to stop.
  // UNREACHABLE WITH THE REGISTER AS IT STANDS (only one direct row can match a
  // real release directory today), and free at fixture level. The day
  // linux-appimage has a lane, mixed becomes the ORDINARY shape: one identity
  // bought, the other still on its sentinel.
  // (The appimage block's key names were `appimage-signing-key` /
  // `appImageSigningKey` — invented — until 2026-08-22; the real row reads
  // `own-signing-key` / `signingPublicKey`. The gate reads SHAPE and not name, so
  // no outcome changed, but a fixture naming a key the register does not have
  // invites the next reader to check the wrong thing.)
  const mixedRegister = () => {
    const r = JSON.parse(JSON.stringify(REGISTER));
    r.channels.push({
      id: 'linux-appimage',
      kind: 'direct',
      served: false,
      artifactFormats: ['.AppImage'],
      deploymentEnvironment: '{app}-linux-appimage',
      signing: { keyKind: 'own-signing-key', signingPublicKey: { notYetConfiguredSentinel: SENTINEL, algorithm: 'ed25519', publicKeyBase64: SENTINEL } },
    });
    return r;
  };
  const MIXED_ASSETS = ['subly-v1-subly.msix', 'subly-v1-subly.AppImage'];

  test('MIXED: one direct row emits and another is withheld IN THE SAME RUN — both halves are returned', () => {
    const { environments, omitted } = originEnvironments(mixedRegister(), 'subly', MIXED_ASSETS);
    assert.deepEqual(environments, ['subly-windows-direct'], 'the pinned row is still recorded');
    assert.equal(omitted.length, 1, 'the sentinel row is still withheld — a non-empty emit list must not swallow it');
    assert.equal(omitted[0].environment, 'subly-linux-appimage');
    assert.equal(omitted[0].id, 'linux-appimage');
    assert.equal(omitted[0].state, 'sentinel');
    assert.match(omitted[0].detail, /signingPublicKey/);
  });

  test('MIXED, THROUGH THE CLI: the emitted name is on STDOUT and the withheld reason on STDERR, together', () => {
    const root = fixture({ register: mixedRegister() });
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    for (const n of MIXED_ASSETS) writeFileSync(join(d, n), n);
    const r = cli(['--emit-environments', d, '--app', 'subly', '--repo-root', root]);
    assert.equal(r.code, 0, r.out);
    // STDOUT is the word list `for environment in $(…)` expands: exactly the one
    // recordable environment, and nothing else may join it.
    assert.equal(r.stdout.trim(), 'subly-windows-direct');
    // 🔴 THIS IS THE ASSERTION THE MUTATION ABOVE FAILS: something DID emit, and
    // the withheld row must still be explained.
    assert.match(r.stderr, /omitted {2}subly-linux-appimage/);
    // 🔴 THE REGISTER'S OWN WORDS, WHICH IS WHAT `/SENTINEL/` HERE DID NOT CHECK.
    // Until 2026-08-24 this asserted `/SENTINEL/` under a message saying exactly
    // that — and `${o.state.toUpperCase()}` prints the literal word SENTINEL, so
    // the assertion was satisfied by the state and could not see the detail at
    // all. Redacting `${o.detail}` left it green (EXIT 0 / 85 pass / 0 fail).
    assert.ok(
      r.stderr.includes(`signing.signingPublicKey still reads ${JSON.stringify(SENTINEL)} at \`publicKeyBase64\``),
      r.stderr,
    );
    assert.match(r.stderr, /channel "linux-appimage"/, 'the withheld row is named by its register id, not only by its environment');
    assert.doesNotMatch(r.stderr, /omitted {2}subly-windows-direct/, 'the pinned row was recorded, not withheld');
    // ...and the "nothing was recorded at all" line belongs to the OTHER empty.
    // Printing it here would tell the log a release recorded nothing while stdout
    // was handing record-deployment.mjs an environment.
    assert.doesNotMatch(r.stderr, /no \[10\]D-9 record for this release/);
  });

  // 🔴 BOTH CLI LOOPS RANGE OVER EVERY ROW, AND NEITHER BOUND HAD ANYTHING
  // HOLDING IT until 2026-08-24. `for (const o of omitted)` and
  // `for (const e of environments)` each survived `.slice(0, 1)` with this file
  // at EXIT 0 / 85 pass / 0 fail, because no CLI case in the suite had ever
  // produced two of either — every fixture above emits at most one name and
  // withholds at most one row. Losing either bound is SILENT in the worst
  // direction: the release records one of the two ledger rows it owes, or
  // explains one of the two it withheld, and both the log and the suite read
  // complete. (The MIXED cases above hold the two loops APART — that a non-empty
  // emit list does not swallow the omissions — but not their LENGTHS.)
  test('TWO of each: every recordable name reaches stdout and every withheld row is explained', () => {
    const pinned = () => ({ keyKind: 'code-signing-certificate', codeSigningCertificate: { ...CONFIGURED_PIN } });
    const onSentinel = () => ({ keyKind: 'code-signing-certificate', codeSigningCertificate: { ...CONFIGURED_PIN, sha256: SENTINEL } });
    const register = {
      channels: [
        { id: 'ok-msix', kind: 'direct', artifactFormats: ['.msix'], deploymentEnvironment: '{app}-ok-msix', signing: pinned() },
        { id: 'ok-exe', kind: 'direct', artifactFormats: ['.exe'], deploymentEnvironment: '{app}-ok-exe', signing: pinned() },
        { id: 'held-dmg', kind: 'direct', artifactFormats: ['.dmg'], deploymentEnvironment: '{app}-held-dmg', signing: onSentinel() },
        { id: 'held-appimage', kind: 'direct', artifactFormats: ['.AppImage'], deploymentEnvironment: '{app}-held-appimage', signing: onSentinel() },
      ],
    };
    const root = fixture({ register });
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    for (const n of ['subly-v1.msix', 'subly-v1.exe', 'subly-v1.dmg', 'subly-v1.AppImage']) writeFileSync(join(d, n), n);
    const r = cli(['--emit-environments', d, '--app', 'subly', '--repo-root', root]);
    assert.equal(r.code, 0, r.out);
    // BOTH names, one per line — this is the word list `for environment in $(…)`
    // expands, so a dropped line is a [10]D-9 row that is simply never written.
    // 🔴 DEEP-EQUAL ON BOTH LINES, NOT `includes` ON ONE. Measured 2026-08-24:
    // weaken this to `assert.ok(r.stdout.includes('subly-ok-exe'))` and the
    // `for (const e of environments)` bound in release-manifest.mjs stops being
    // held — that pair goes GREEN at 86 pass / 0 fail, where the bound alone is
    // red at 85/1. This assertion is the only reader of the SECOND name.
    // (The `\r?` inside it is not load-bearing; see section B of the ledger.)
    assert.deepEqual(r.stdout.trim().split(/\r?\n/), ['subly-ok-exe', 'subly-ok-msix'], r.out);
    // BOTH reasons.
    assert.match(r.stderr, /omitted {2}subly-held-dmg — channel "held-dmg"/, r.stderr);
    assert.match(r.stderr, /omitted {2}subly-held-appimage — channel "held-appimage"/, r.stderr);
    // Something WAS recorded, so the "nothing at all" line does not belong here.
    assert.doesNotMatch(r.stderr, /no \[10\]D-9 record for this release/);

    // 🔴 AND WHEN NOTHING IS RECORDED, THE CLOSING LINE COUNTS THE ROWS IT
    // WITHHELD. `all ${omitted.length}` survived being frozen to the literal `1`
    // on 2026-08-24 with this file at EXIT 0 / 86 pass / 0 fail: the only case
    // that ever reached that line withheld exactly ONE row, so the literal read
    // true. Staging ONLY the two withheld formats out of this same register
    // empties stdout and leaves two omissions — a release that owed two [10]D-9
    // rows and wrote none must not report it as one, or the reader stops looking
    // after the first channel they fix.
    const heldOnly = join(TMP, `d${seq++}`);
    mkdirSync(heldOnly, { recursive: true });
    for (const n of ['subly-v1.dmg', 'subly-v1.AppImage']) writeFileSync(join(heldOnly, n), n);
    const h = cli(['--emit-environments', heldOnly, '--app', 'subly', '--repo-root', root]);
    assert.equal(h.code, 0, h.out);
    assert.equal(h.stdout.trim(), '', 'nothing was recordable, so nothing may reach the word list');
    // 🔴 THE DIGIT `2` IS THE ASSERTION. Measured 2026-08-24: relax it to
    // `all \d matching` and `all ${omitted.length}` in release-manifest.mjs stops
    // being held — that pair goes GREEN at 86 pass / 0 fail, where freezing the
    // count to a literal `1` alone is red at 85/1. This is the only case in the
    // file that withholds more than one row, so it is the only place the count
    // can be read at all.
    assert.match(h.stderr, /all 2 matching direct channel\(s\) were omitted above/, h.stderr);
  });

  test('MATCHED-AND-WITHHELD and MATCHED-NOTHING are different empties, and only one fails', () => {
    const root = fixture({
      register: registerWith((row) => {
        row.signing.codeSigningCertificate.sha256 = SENTINEL;
        row.signing.codeSigningCertificate.subject = SENTINEL;
      }),
    });
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'notes.txt'), 'x');
    const r = cli(['--emit-environments', d, '--app', 'subly', '--repo-root', root]);
    // No direct row matched at all — the pre-existing fail-closed path, which
    // this increment must not have swallowed into the new exit-0 branch.
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `kind: "direct"` and no `surface: "extension"` channel/);
    assert.doesNotMatch(r.out, /omitted {2}/, 'a row that never matched is not a row that was withheld');
    // The die names what the release DID hold, so the reader can see it was a
    // .txt and not an empty stage.
    assert.match(r.out, /The release holds: notes\.txt\./);

    // ...and an EMPTY release directory reaches the same die by a different road.
    // `${names.join(', ') || '(nothing)'}` — the `|| '(nothing)'` fallback is
    // older than this change and survived `if (false)` on 2026-08-24 at EXIT 0 /
    // 86 pass / 0 fail, because no case had ever run this mode over an empty
    // directory. Without it the line reads "The release holds: ." and the one
    // question the message exists to answer — what WAS staged — is answered with
    // whitespace.
    const empty = join(TMP, `d${seq++}`);
    mkdirSync(empty, { recursive: true });
    const e = cli(['--emit-environments', empty, '--app', 'subly', '--repo-root', root]);
    assert.equal(e.code, 1, e.out);
    assert.match(e.out, /The release holds: \(nothing\)\./);
    assert.equal(e.stdout.trim(), '');

    // ...and the join RANGES OVER EVERY STAGED FILE. `names.join(', ')` sliced to
    // its first element survived on 2026-08-24 at EXIT 0 / 86 pass / 0 fail —
    // both cases above stage at most one file, so a bound that stops at the first
    // reads identically. The one question this message exists to answer is what
    // WAS staged, and a real stage is never one file: answering it with the
    // alphabetically-first asset is how a reader concludes the build produced
    // nothing else. (Pre-existing text, not this change's — swept because it sits
    // inside the CLI block this change rewrote and the comment there claims the
    // block was swept whole.)
    const two = join(TMP, `d${seq++}`);
    mkdirSync(two, { recursive: true });
    writeFileSync(join(two, 'notes.txt'), 'x');
    writeFileSync(join(two, 'README.md'), 'x');
    const t = cli(['--emit-environments', two, '--app', 'subly', '--repo-root', root]);
    assert.equal(t.code, 1, t.out);
    assert.match(t.out, /The release holds: README\.md, notes\.txt\./, t.out);
  });

  // 🔴 THE NAME BELOW SAID "both direct rows sit on their sentinels today" until
  // 2026-08-24. That was TRUE when measured (windows-direct on
  // CODE-SIGNING-CERT-NOT-PURCHASED, linux-appimage on
  // APPIMAGE-SIGNING-KEY-NOT-GENERATED) but this case asserts it of NEITHER row —
  // it measures `windows-direct` and branches. A name is prose, and prose may not
  // carry a check the body does not hold, so the count came out of the name
  // rather than an assertion going into the body: pinning "two rows, both on
  // sentinels" is exactly the August fact the deleted block below explains this
  // case must not freeze.
  test('THE REAL REGISTER: a direct row on its sentinel keeps a real release from recording it', () => {
    const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const direct = register.channels.filter((c) => c.kind === 'direct');
    assert.ok(direct.length >= 1, 'this whole gate ranges over direct rows; none means it ranges over nothing');
    // ⛔ DELETED 2026-08-24 — an assertion that could not fail:
    //     for (const c of direct) assert.ok(
    //       ['sentinel', 'pinned', 'none', 'undeclared'].includes(signingPosture(c).state));
    // signingPosture has exactly four `state:` literals and those were the four,
    // so the loop asserted that a function returns one of the values it returns.
    // It could not be pinned — no register a human can write reaches a fifth
    // state — so it is removed rather than rewritten. What the row's posture
    // ACTUALLY has to satisfy is the branch below, which is measured, not listed.
    // Not pinned to 2 direct rows either: the day a third is added this must keep
    // measuring, not keep asserting a count taken in August.
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'subly-v1.0.0-subly.msix'), 'msix');
    const r = cli(['--emit-environments', d, '--app', 'subly']);
    const withheld = direct.filter((c) => signingPosture(c).state === 'sentinel').map((c) => c.id);
    if (withheld.includes('windows-direct')) {
      // 🔴 THIS IS THE STATE ON 2026-08-21 and the assertion is written so that
      // FILLING THE PIN IN turns it into the other branch rather than into a
      // silent pass: `signing.codeSigningCertificate` reads
      // CODE-SIGNING-CERT-NOT-PURCHASED, so the release publishes the .msix and
      // records no deployment for it.
      assert.equal(r.code, 0, r.out);
      assert.equal(r.stdout.trim(), '', 'the real register must not emit an environment for an identity that does not exist');
      assert.match(r.stderr, /omitted {2}subly-windows-direct/);
    } else {
      // The certificate was purchased and the pin filled. The row is recordable
      // again and this side of the branch is what proves the gate opens.
      // 🔴 DISCLOSED, NOT HIDDEN: THIS ARM CANNOT RUN AGAINST TODAY'S TREE, and
      // it is the one atom in this file that no input reaches. Measured
      // 2026-08-24 — force the `if` to `true` and the file stays at 86 pass / 0
      // fail (the live arm is this test's real one); force it to `false` and the
      // file goes to 85 pass / 1 fail, i.e. these two assertions are WRONG about
      // the register as it stands. It is kept rather than deleted because
      // deleting it is what makes the day the pin is filled a SILENT pass: with
      // only the sentinel arm written, `withheld` would simply go empty and the
      // case would assert nothing at all. It is a live assertion about a future
      // state, not an assertion that cannot fail — the day `signing` is filled in
      // it runs, and if the gate does not open it fails.
      assert.equal(r.code, 0, r.out);
      assert.equal(r.stdout.trim(), 'subly-windows-direct');
    }
  });
});

describe('release-manifest.mjs — verification fails in BOTH directions', () => {
  const dir = () => {
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'one.apk'), 'one');
    writeFileSync(join(d, 'two.msix'), 'two');
    return d;
  };
  const writeManifest = (d) => cli(['--write', d, '--app', 'subly', '--tag', 'subly-v1', '--sha', '93aee1d']);

  test('an asset the manifest does NOT name fails — "naming every asset" is the acceptance\'s wording', () => {
    const d = dir();
    assert.equal(writeManifest(d).code, 0);
    writeFileSync(join(d, 'three.apk'), 'snuck in');
    const r = cli(['--verify', d]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /three\.apk is in the release directory and the manifest does NOT name it/);
  });

  test('a named asset that is missing fails', () => {
    const d = dir();
    assert.equal(writeManifest(d).code, 0);
    rmSync(join(d, 'two.msix'));
    const r = cli(['--verify', d]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /two\.msix is named by the manifest and is not in the release directory/);
  });

  test('one changed byte fails', () => {
    const d = dir();
    assert.equal(writeManifest(d).code, 0);
    writeFileSync(join(d, 'one.apk'), 'onx');
    const r = cli(['--verify', d]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /one\.apk hashes to/);
  });

  test('an untouched directory verifies, and the check reports the commit it carries', () => {
    const d = dir();
    assert.equal(writeManifest(d).code, 0);
    const r = cli(['--verify', d]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 asset\(s\) verified against SHA256SUMS; commit 93aee1d/);
  });

  test('a manifest naming zero assets verifies nothing and says so', () => {
    const d = dir();
    const { entries, problems } = verifyEntries(d, '# commit: 93aee1d\n');
    assert.equal(entries.length, 0);
    assert.ok(problems.some((p) => /names ZERO assets/.test(p)));
  });

  test('assetFiles excludes the manifest itself and reports directories as strays', () => {
    const d = dir();
    assert.equal(writeManifest(d).code, 0);
    mkdirSync(join(d, 'leftover'));
    const { names, strays } = assetFiles(d);
    assert.ok(!names.includes(MANIFEST_NAME));
    assert.deepEqual(strays, ['leftover']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 [pipeline G3] — CONSISTENCY IS NOT COMPLETENESS.
// Measured before `--expect-formats` existed: a release holding the .apk and the
// .aab and NO .msix at all wrote a manifest and verified clean, printing
// `ok  2 asset(s) verified`. Every word true; a whole platform missing.
// ─────────────────────────────────────────────────────────────────────────────
describe('release-manifest.mjs — the expected-format set is DERIVED, not typed', () => {
  /** Register rows only earn a place in the expectation when they declare a LANE
   *  — that is the register saying some job in this factory emits the format. */
  const REG = {
    channels: [
      { id: 'web', kind: 'web', served: true, artifactFormats: ['static-bundle'], lane: { workflow: 'w.yml', job: 'j' } },
      { id: 'android-play', kind: 'store', served: false, artifactFormats: ['.aab'], lane: { workflow: 'w.yml', job: 'j' } },
      { id: 'windows-store', kind: 'store', served: false, artifactFormats: ['.msix'], lane: { workflow: 'w.yml', job: 'k' } },
      { id: 'windows-direct', kind: 'direct', served: false, artifactFormats: ['.msix', '.exe'], lane: null },
      { id: 'ios-appstore', kind: 'store', served: false, artifactFormats: ['.ipa'], lane: null },
    ],
  };

  test('a lane-less channel is a channel that does not exist yet — its format is not demanded', () => {
    const expected = expectedReleaseFormats(REG);
    assert.deepEqual([...expected].sort(), ['.aab', '.apk', '.msix']);
    assert.ok(!expected.has('.ipa'), 'demanding an .ipa no lane builds would fail every release for work nobody started');
  });

  test('a BUNDLE MEMBER is never expected loose — it travels inside its platform archive', () => {
    const withExe = { channels: [{ id: 'x', artifactFormats: ['.exe', '.msix'], lane: { workflow: 'w.yml', job: 'j' } }] };
    const expected = expectedReleaseFormats(withExe);
    assert.ok(expected.has('.msix'));
    assert.ok(!expected.has('.exe'), 'requiring a format --stage deliberately never lifts is an assertion that cannot pass');
  });

  test('the expectation NARROWS the installable set and never widens it', () => {
    const installable = installableExtensions(REG);
    for (const e of expectedReleaseFormats(REG)) assert.ok(installable.has(e), `${e} escaped the single installable declaration`);
  });

  test('the `.apk` is expected through the declared extra — no channel can ever declare it', () => {
    assert.ok(expectedReleaseFormats(REG).has('.apk'));
    assert.ok(EXTRA_INSTALLABLE.has('.apk'));
  });

  test('a register whose rows are all lane-less contributes NOTHING — only the declared extra survives', () => {
    // The CLI treats exactly this as COVERAGE LOST rather than as a small
    // expectation; the case is proven end-to-end further down.
    assert.deepEqual([...expectedReleaseFormats({ channels: [{ id: 'x', artifactFormats: ['.ipa'], lane: null }] })].sort(), ['.apk']);
  });

  test('missingReleaseFormats answers by extension, case-insensitively, sorted', () => {
    assert.deepEqual(missingReleaseFormats(new Set(['.msix', '.aab']), ['a.aab']), ['.msix']);
    assert.deepEqual(missingReleaseFormats(new Set(['.msix']), ['SUBLY-V1.MSIX']), [], 'a capitalised extension is the same artifact');
    assert.deepEqual(missingReleaseFormats(new Set(['.msix', '.aab', '.apk']), []), ['.aab', '.apk', '.msix']);
  });

  // ⚠️ THE NAME OF THIS TEST USED TO BE "…exactly what the release lane stages
  // today", AND ON 2026-08-09 THAT STOPPED BEING THE SAME QUESTION. `linux-snap`
  // gained a lane — .github/workflows/submit-snap.yml's `dry-run` job packs a real
  // .snap — so the factory now EMITS a format that build-platforms.yml's release
  // job does not stage: it is a different workflow, on a dispatch-only trigger,
  // and `download-artifact` reaches only the current run's own artifacts.
  //
  // 🔴 NOTHING IS RED TODAY AND ONE THING WILL BE. The release job runs `--verify`
  // WITHOUT `--expect-formats` (the flag is exercised only by this file), so the
  // wider set changes no lane's outcome. The increment that wires the flag into
  // that job — the one the "DEFAULT BEHAVIOUR IS UNCHANGED" test below anticipates
  // — will get a red naming `.snap`, and that red is correct rather than
  // spurious: it is the question "should the expectation narrow to lanes that FEED
  // the release, or should the .snap reach one?" arriving at the moment somebody
  // can answer it, instead of a silent pass over a release missing a platform.
  test('the REAL register resolves to every format a lane in this factory emits', () => {
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    // ⚠️ `.zip` JOINED THIS SET ON 2026-09-05, and it is the reason `--for-workflow`
    // exists rather than a reason to widen the narrowing. The register acquired
    // three extension store rows whose lane is extensions.yml's `release` job,
    // and that job emits dist/<tool>-<target>.zip — so a release staged from
    // build-platforms.yml legitimately does not carry it, exactly as it does not
    // carry the `.snap` submit-snap.yml emits. The narrowed cases below are what
    // a real lane asks.
    assert.deepEqual([...expectedReleaseFormats(real)].sort(), ['.aab', '.apk', '.msix', '.snap', '.zip']);
  });

  // ⚠️ THE QUESTION THE NOTE ABOVE PARKED WAS ANSWERED 2026-08-27, AND ONLY HALF
  // OF IT. `expectedReleaseFormats` now takes a workflow and narrows the
  // lane-backed half to the rows that workflow emits — the "expectation narrows to
  // lanes that FEED the release" branch. What has NOT happened is the wiring:
  // build-platforms.yml:1298 still runs plain `--verify dist`, so on the real lane
  // the completeness question remains DERIVABLE and UNASKED.
  test('narrowed to the workflow that STAGES the dist, the .snap is not demanded of it', () => {
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const bp = expectedReleaseFormats(real, '.github/workflows/build-platforms.yml');
    assert.deepEqual([...bp].sort(), ['.aab', '.apk', '.msix']);
    assert.ok(!bp.has('.snap'), 'submit-snap.yml is a different workflow on a different trigger; download-artifact cannot reach its output');
  });

  test('narrowed to submit-snap.yml the .snap IS demanded and the store artifacts are not', () => {
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    assert.deepEqual([...expectedReleaseFormats(real, 'submit-snap.yml')].sort(), ['.apk', '.snap']);
  });

  test('narrowing is a FILTER on the unnarrowed set', () => {
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const all = expectedReleaseFormats(real);
    for (const w of ['.github/workflows/build-platforms.yml', 'submit-snap.yml', 'nope.yml']) {
      for (const e of expectedReleaseFormats(real, w)) assert.ok(all.has(e), `${e} appeared only under --for-workflow ${w}`);
    }
  });

  test('a workflow naming NO row narrows the register\'s half to nothing — the empty the CLI treats as COVERAGE LOST', () => {
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    // Only the declared extra survives. Proven end-to-end against the CLI below;
    // here to pin that this is the state the rail there is aimed at.
    assert.deepEqual([...expectedReleaseFormats(real, 'nope.yml')].sort(), ['.apk']);
    // ⚠️ AND A REAL LANE REACHES IT TOO, which is why the rail is not hypothetical:
    // deploy-web.yml IS a declared lane, and its only artifactFormat is
    // `static-bundle` — a shape name, not a file extension — so it contributes none.
    assert.deepEqual([...expectedReleaseFormats(real, 'deploy-web.yml')].sort(), ['.apk']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `laneIsWorkflow` compares strings and never calls `node:path`, deliberately:
// `basename()` treats `\` as a separator on Windows and as an ordinary filename
// character on Linux, so a backslash-separated argument would match here and
// COVERAGE-LOST on the runner. Every case below was ALSO driven under WSL
// (node v22.22.1, Linux 6.18.33.2-microsoft-standard-WSL2) against the real
// register on 2026-08-27 and returned the same exit codes as this Windows host.
// ─────────────────────────────────────────────────────────────────────────────
describe('release-manifest.mjs — laneIsWorkflow answers the same on every OS', () => {
  const LANE = '.github/workflows/build-platforms.yml';

  test('the full repo-relative path and the bare file name both answer yes', () => {
    assert.ok(laneIsWorkflow(LANE, LANE));
    assert.ok(laneIsWorkflow(LANE, 'build-platforms.yml'));
  });

  // 🔴 BOTH HALVES ARE HERE BECAUSE ONE OF THEM IS BLIND ON EACH OS, AND THE
  // FIRST DRAFT SHIPPED ONLY THE BLIND-ON-WINDOWS HALF. Measured 2026-08-27 with
  // `leaf` swapped for `node:path`'s `basename`: the backslash case stays GREEN on
  // this Windows host and goes RED under WSL — the wave that ships green
  // here and fails on Ubuntu, in one file. The drive-relative case is
  // the mirror: win32 `basename('C:build-platforms.yml')` is `build-platforms.yml`
  // and posix `basename` leaves it whole, so THAT half reddens on Windows and is
  // blind on Linux. Together the mutation is caught wherever it is run.
  test('a BACKSLASH-separated argument answers yes on Linux too, where basename() would say no', () => {
    assert.ok(laneIsWorkflow(LANE, '.github\\workflows\\build-platforms.yml'));
  });

  test('a DRIVE-RELATIVE name answers no on Windows too, where basename() would say yes', () => {
    assert.ok(!laneIsWorkflow(LANE, 'C:build-platforms.yml'), 'a workflow is a repo path, never a drive-relative one');
  });

  test('the comparison is CASE-SENSITIVE — matching here and missing on the runner is the worse failure', () => {
    assert.ok(!laneIsWorkflow(LANE, 'Build-Platforms.yml'));
    assert.ok(!laneIsWorkflow(LANE, '.GITHUB/WORKFLOWS/BUILD-PLATFORMS.YML'));
  });

  test('a different workflow, a suffix of one, and a non-string all answer no', () => {
    assert.ok(!laneIsWorkflow(LANE, 'submit-snap.yml'));
    assert.ok(!laneIsWorkflow(LANE, 'platforms.yml'), 'a substring is not a workflow');
    assert.ok(!laneIsWorkflow(LANE, ''), 'an empty name must not match every row');
    assert.ok(!laneIsWorkflow(LANE, null));
    assert.ok(!laneIsWorkflow(null, LANE));
  });
});

describe('release-manifest.mjs — `--verify --expect-formats` (the G3 half)', () => {
  const staged = (files) => {
    const d = join(TMP, `g${seq++}`);
    mkdirSync(d, { recursive: true });
    for (const f of files) writeFileSync(join(d, f), f);
    assert.equal(cli(['--write', d, '--app', 'subly', '--tag', 'subly-v1', '--sha', '93aee1d']).code, 0);
    return d;
  };
  // ⚠️ `.snap` JOINED THIS SET ON 2026-08-09 — see the note above the REAL-register
  // test. These cases drive the CLI against the real register, so "complete" here
  // means every format a lane emits, which is not the same as every format
  // build-platforms.yml's release job stages. That divergence is recorded there.
  // NOTE 2026-09-05: `.zip` joined the UNNARROWED expectation when the register
  // acquired the three extension store rows, whose lane is extensions.yml#release
  // and which emits dist/<tool>-<target>.zip. These cases exercise the unnarrowed
  // form on purpose, so the fixture carries one — exactly as it carries the .snap
  // no build-platforms dist holds either. The narrowed cases below are what a
  // real lane asks.
  const COMPLETE = [
    'subly-v1-app-release.apk',
    'subly-v1-app-release.aab',
    'subly-v1-subly.msix',
    'subly-v1-subly.snap',
    'fullshot-v1-chromium.zip',
  ];

  test('THE RECORDED FAILING CASE — a release with no .msix verifies clean and IS NOT COMPLETE', () => {
    const d = staged(COMPLETE.filter((f) => !f.endsWith('.msix')));
    const plain = cli(['--verify', d]);
    assert.equal(plain.code, 0, 'the manifest is CORRECT — it describes this directory exactly, which is the point');
    const strict = cli(['--verify', d, '--expect-formats']);
    assert.equal(strict.code, 1, strict.out);
    assert.match(strict.out, /missing 1 expected release format\(s\): \.msix/);
    assert.match(strict.out, /a release missing a/);
  });

  test('a complete release passes and NAMES what it checked', () => {
    const d = staged(COMPLETE);
    const r = cli(['--verify', d, '--expect-formats']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /all 5 expected format\(s\) present: \.aab, \.apk, \.msix, \.snap, \.zip/);
  });

  test('DEFAULT BEHAVIOUR IS UNCHANGED — without the flag nothing new can go red', () => {
    // The release job passes the flag in a LATER increment. Until then this must
    // behave exactly as it did, or a workflow file this change cannot edit turns
    // red for a reason nobody introduced.
    const d = staged(['subly-v1-app-release.apk']);
    const r = cli(['--verify', d]);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /expected format/);
  });

  test('the expectation follows the register it is pointed at, not a list in the script', () => {
    const root = fixture({
      register: { channels: [{ id: 'linux-appimage', kind: 'direct', artifactFormats: ['.AppImage'], lane: { workflow: 'w.yml', job: 'j' } }] },
      workflows: {},
    });
    const d = staged(['subly-v1-app-release.apk']);
    const r = cli(['--verify', d, '--expect-formats', '--repo-root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\.AppImage/, 'a channel added to the register is demanded with no edit to this script');
  });

  test('COVERAGE LOST when the REGISTER stops contributing and only the hardcoded extras are left', () => {
    // The rail is on the register's half, because the total can never be empty
    // (`EXTRA_INSTALLABLE` always carries the .apk) and an assertion with no
    // failing input is worse than none. Every row lane-less — which is also what
    // a broken lane derivation looks like — and the expectation collapses to one
    // sideloadable .apk that would certify a release missing every store artifact.
    const root = fixture({
      register: {
        channels: [
          { id: 'ios-appstore', kind: 'store', artifactFormats: ['.ipa'], lane: null },
          { id: 'windows-direct', kind: 'direct', artifactFormats: ['.msix'], lane: null },
        ],
      },
      workflows: {},
    });
    const d = staged(['subly-v1-app-release.apk']);
    const r = cli(['--verify', d, '--expect-formats', '--repo-root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /collapsed to the declared extras alone/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 `--for-workflow` — THE DIST BELONGS TO ONE WORKFLOW.
  // GREEN-WHILE-BROKEN is the hazard of this flag, not redness: narrowing to a
  // name that matches no row empties the register's half, and "expected nothing,
  // found nothing" would exit 0 over a dist missing every platform. The floor is
  // the point of the flag, so it is tested before the flag's happy path.
  // ⚠️ STILL UNWIRED: build-platforms.yml:1298 runs plain `--verify dist`.
  // ───────────────────────────────────────────────────────────────────────────
  const BUILD_PLATFORMS = ['subly-v1-app-release.apk', 'subly-v1-app-release.aab', 'subly-v1-subly.msix'];

  test('🔴 THE FLOOR — a workflow matching ZERO rows is COVERAGE LOST', () => {
    // Handed a directory carrying every format build-platforms stages, so nothing
    // but the empty expectation can be what fails. Exit 0 here would be a check
    // that reads as completeness and asserts nothing.
    const d = staged(BUILD_PLATFORMS);
    const r = cli(['--verify', d, '--expect-formats', '--for-workflow', 'nope.yml']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /nope\.yml names no lane in the register/);
  });

  test('🔴 THE FLOOR IS REACHED BY A REAL LANE TOO — deploy-web.yml emits no file at all', () => {
    // `web`'s only artifactFormat is `static-bundle`, a shape name. A caller who
    // narrows to the workflow that deploys it gets nothing back, and nothing back
    // must not certify a release. This is the case that makes the rail non-theoretical.
    const d = staged(BUILD_PLATFORMS);
    const r = cli(['--verify', d, '--expect-formats', '--for-workflow', 'deploy-web.yml']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('narrowed to build-platforms.yml, a dist SHORT THE .msix still fails naming it', () => {
    const d = staged(BUILD_PLATFORMS.filter((f) => !f.endsWith('.msix')));
    assert.equal(cli(['--verify', d]).code, 0, 'plain --verify is still silent about the missing platform');
    const r = cli(['--verify', d, '--expect-formats', '--for-workflow', 'build-platforms.yml']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /missing 1 expected release format\(s\): \.msix/);
  });

  test('narrowed to build-platforms.yml, its own complete dist passes and NAMES the three', () => {
    const d = staged(BUILD_PLATFORMS);
    const r = cli(['--verify', d, '--expect-formats', '--for-workflow', '.github/workflows/build-platforms.yml']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /all 3 expected format\(s\) present: \.aab, \.apk, \.msix/);
  });

  test('🔴 UNNARROWED, THAT SAME DIST IS RED — which is why the flag could not be wired as it stood', () => {
    // The measurement that made this increment derivation-only: `linux-snap`
    // declares submit-snap.yml, a different workflow on a dispatch-only trigger,
    // so wiring `--expect-formats` alone into the release job would fail every tag
    // push naming an artifact build-platforms can never produce.
    const d = staged(BUILD_PLATFORMS);
    const r = cli(['--verify', d, '--expect-formats']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /missing 2 expected release format\(s\): \.snap, \.zip/);
  });

  test('--for-workflow WITHOUT --expect-formats refuses — a silent no-op would print ok', () => {
    const d = staged(BUILD_PLATFORMS);
    const r = cli(['--verify', d, '--for-workflow', 'build-platforms.yml']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /only narrows --expect-formats/);
  });

  // 🔴 THAT REFUSAL SAT INSIDE `--verify` UNTIL 2026-08-27, so it caught only the typo
  // that KEPT `--verify`. These are the other modes a caller can put those words on.
  test('--expect-formats on --write REFUSES — the mode it modifies is not this one', () => {
    const d = staged(BUILD_PLATFORMS.filter((f) => !f.endsWith('.msix')));
    const r = cli(['--write', d, '--app', 'subly', '--tag', 'subly-v1', '--sha', '93aee1d', '--expect-formats', '--for-workflow', 'build-platforms.yml']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /--expect-formats is read by --verify alone, and this invocation runs --write\./);
  });

  test('--expect-formats on --emit-assets REFUSES — the publish step is the same two lines away', () => {
    const d = staged(BUILD_PLATFORMS);
    const r = cli(['--emit-assets', d, '--expect-formats']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /this invocation runs --emit-assets\./);
  });

  test('a MODE COLLISION cannot carry the flags past the refusal — the dispatch would run --write', () => {
    const d = staged(BUILD_PLATFORMS);
    const r = cli(['--write', d, '--app', 'subly', '--tag', 'subly-v1', '--sha', '93aee1d', '--verify', d, '--expect-formats']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /this invocation runs --write\./);
  });

  test('--for-workflow WITHOUT --expect-formats refuses in every mode, not only --verify', () => {
    const d = staged(BUILD_PLATFORMS);
    const r = cli(['--emit-assets', d, '--for-workflow', 'build-platforms.yml']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /only narrows --expect-formats/);
  });

  test('DEFAULT BEHAVIOUR IS STILL UNCHANGED — no --for-workflow means the old expectation', () => {
    const d = staged(COMPLETE);
    const r = cli(['--verify', d, '--expect-formats']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /all 5 expected format\(s\) present: \.aab, \.apk, \.msix, \.snap, \.zip/);
  });
});

describe('release-manifest.mjs — the CLI refuses rather than producing a hollow release', () => {
  test('--write refuses a --sha that is not a commit', () => {
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'one.apk'), 'one');
    const r = cli(['--write', d, '--app', 'subly', '--tag', 'subly-v1', '--sha', 'TODO']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is not a commit SHA/);
  });

  test('--write refuses an empty directory', () => {
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    const r = cli(['--write', d, '--app', 'subly', '--tag', 'subly-v1', '--sha', '93aee1d']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /holds no asset/);
  });

  test('--verify refuses a directory with no manifest at all', () => {
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'one.apk'), 'one');
    const r = cli(['--verify', d]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not exist/);
  });

  test('--stage refuses when the download tree holds no installer', () => {
    const from = join(TMP, `s${seq++}`);
    mkdirSync(join(from, 'subly-web'), { recursive: true });
    writeFileSync(join(from, 'subly-web', 'index.html'), '<html>');
    const out = join(TMP, `o${seq++}`);
    const r = cli(['--stage', from, '--out', out, '--app', 'subly', '--tag', 'subly-v1']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no installable artifact found/);
    assert.match(r.out, /A release with no installer is a release of nothing/);
  });

  test('--stage MOVES the installer, names it after the tag, and leaves nothing behind to duplicate', () => {
    const from = join(TMP, `s${seq++}`);
    mkdirSync(join(from, 'subly-linux', 'app', 'outputs'), { recursive: true });
    writeFileSync(join(from, 'subly-linux', 'app', 'outputs', 'app-release.apk'), 'apk');
    const out = join(TMP, `o${seq++}`);
    const r = cli(['--stage', from, '--out', out, '--app', 'subly', '--tag', 'subly-v1.0.0']);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(assetFiles(out).names, ['subly-v1.0.0-app-release.apk']);
    assert.equal(assetFiles(join(from, 'subly-linux', 'app', 'outputs')).names.length, 0, 'the installer must not exist twice');
  });

  test('--stage LEAVES a bundle member where it is — lifting a runner .exe breaks the exe AND the bundle', () => {
    // The defect the first local dry run of the release lane found, 2026-08-06:
    // `subly.exe` was moved out of build/windows/x64/runner/Release, producing a
    // loose executable with no DLLs beside it and an archive with no executable
    // in it. Neither would run, and the manifest would have said both were fine.
    const from = join(TMP, `s${seq++}`);
    mkdirSync(join(from, 'subly-windows', 'x64', 'runner', 'Release'), { recursive: true });
    mkdirSync(join(from, 'subly-windows', 'msix'), { recursive: true });
    writeFileSync(join(from, 'subly-windows', 'x64', 'runner', 'Release', 'subly.exe'), 'exe');
    writeFileSync(join(from, 'subly-windows', 'x64', 'runner', 'Release', 'flutter_windows.dll'), 'dll');
    writeFileSync(join(from, 'subly-windows', 'msix', 'subly.msix'), 'msix');
    const out = join(TMP, `o${seq++}`);
    const r = cli(['--stage', from, '--out', out, '--app', 'subly', '--tag', 'subly-v1']);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(assetFiles(out).names, ['subly-v1-subly.msix'], 'only the self-contained package is lifted');
    assert.deepEqual(
      assetFiles(join(from, 'subly-windows', 'x64', 'runner', 'Release')).names.sort(),
      ['flutter_windows.dll', 'subly.exe'],
      'the bundle must still be whole so its archive is usable',
    );
  });

  test('every bundle member carries a reason, so the exclusion cannot be a silent hole', () => {
    assert.ok(BUNDLE_MEMBERS.size > 0);
    for (const [ext, why] of BUNDLE_MEMBERS) {
      assert.match(ext, /^\.[A-Za-z0-9]+$/);
      assert.ok(why.length > 80, `${ext} needs a reason that survives being read aloud`);
    }
    // ...and it is still an INSTALLABLE for the guard: a lane uploading one and
    // publishing nothing durable is still R-4's negation.
    for (const ext of BUNDLE_MEMBERS.keys()) assert.ok(installableExtensions(REGISTER).has(ext));
  });

  test('--emit-assets puts the manifest FIRST — a verifier needs it before any other file', () => {
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'one.apk'), 'one');
    assert.equal(cli(['--write', d, '--app', 'subly', '--tag', 'subly-v1', '--sha', '93aee1d']).code, 0);
    const r = cli(['--emit-assets', d]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out.split('\n')[0], new RegExp(`${MANIFEST_NAME}$`));
  });

  test('--emit-environments refuses to print nothing — publishing while recording nothing is an unrecorded deploy', () => {
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'notes.txt'), 'x');
    const r = cli(['--emit-environments', d, '--app', 'subly']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `kind: "direct"` and no `surface: "extension"` channel/);
  });

  test('--emit-environments resolves the real register to a real environment NAME', () => {
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'subly-v1-subly.msix'), 'msix');
    const r = cli(['--emit-environments', d, '--app', 'subly']);
    assert.equal(r.code, 0, r.out);
    // 🔴 `out`, NOT `stdout`, AND THAT IS THE WHOLE POINT OF THIS CASE. What it
    // has always tested is the RESOLUTION — that the real register's
    // `deploymentEnvironment` template plus `--app subly` produces the string
    // `subly-windows-direct` rather than a `{app}` left unsubstituted. Since
    // 2026-08-21 that row is withheld on signing posture, so the resolved name
    // now appears on stderr in the omission line instead of on stdout. WHICH
    // stream it lands on is asserted by the posture block above; this case must
    // not silently become a second, weaker copy of that assertion.
    // ⚠️ BOTH OF THE NEXT TWO LINES SURVIVE BEING LOOSENED and both are kept —
    // section C of the ledger above the posture describe(). Measured 2026-08-24:
    // `/subly-windows-direct/` relaxed to `/subly/`, and the `doesNotMatch`
    // deleted outright, each left this file at EXIT 0 / 86 pass / 0 fail,
    // because the posture block already asserts this line as a WHOLE STRING.
    // They stay because this case is the one that reads the LIVE register rather
    // than a fixture, and `{app}` unsubstituted is the failure it was written
    // for; a stronger assertion here would be a second copy of a fixture case.
    assert.match(r.out, /subly-windows-direct/);
    assert.doesNotMatch(r.out, /\{app\}/);
  });

  test('with no mode it refuses instead of doing something plausible', () => {
    const r = cli([]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no mode given/);
  });
});

describe('the real tree still satisfies the mechanism it declares', () => {
  test('build-platforms.yml writes, verifies and publishes from the SAME directory', () => {
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'build-platforms.yml'), 'utf8');
    const write = wf.match(/release-manifest\.mjs --write (\S+)/);
    const verify = wf.match(/release-manifest\.mjs --verify (\S+)/);
    const emit = wf.match(/release-manifest\.mjs --emit-assets (\S+)\)/);
    assert.ok(write && verify && emit, 'the release lane must write, verify and publish from one directory');
    assert.equal(write[1], verify[1]);
    assert.equal(write[1], emit[1]);
  });

  test('the release job has NO job-level `if:` — a skipped job fails the aggregator', () => {
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'build-platforms.yml'), 'utf8');
    const at = wf.indexOf('\n  release:\n');
    assert.ok(at > 0, 'the release job must exist');
    const body = wf.slice(at + 1, wf.length);
    assert.doesNotMatch(body.split('\n').slice(0, 40).join('\n'), /^ {4}if:/m);
  });

  test('the aggregator needs the release job, so a failed publish cannot go green', () => {
    // Comments stripped FIRST, exactly as assert-platform-proof-fresh.mjs does
    // before it reads the same expression. Without that, the first flow-form
    // `needs: [...]` in the file is the one inside the `prepare` job's COMMENT
    // warning about this very fragility — and the assertion then measures a
    // sentence about the wiring instead of the wiring. Caught on the first run
    // of this test, 2026-08-06.
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'build-platforms.yml'), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    const needs = wf.match(/needs:\s*\[([^\]]+)\]/)[1];
    assert.match(needs, /\brelease\b/);
    assert.match(needs, /\ball_platforms\b|\bgate\b/, 'the aggregator is the job this matched');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE EXTENSION SURFACE — added 2026-09-05 with the chrome-webstore /
// edge-addons / amo rows. Two independent changes are held here:
//
//   · `originEnvironments` emits a `surface: "extension"` row as well as a
//     `kind: "direct"` one, because on that surface the GitHub Release IS the
//     origin of the very bytes the store takes.
//   · limb 1's "is this a release lane?" moved from the WORKFLOW to the JOB,
//     because one file now holds three lanes and the job that uploads the zip
//     cannot run on a tag at all.
// ─────────────────────────────────────────────────────────────────────────────
describe('release-manifest.mjs — the extension surface is an origin too', () => {
  const EXT_ROW = {
    id: 'chrome-webstore',
    kind: 'store',
    surface: 'extension',
    served: false,
    artifactFormats: ['.zip'],
    deploymentEnvironment: '{app}-chrome-webstore',
    signing: { keyKind: 'none', identity: null },
  };

  test('a surface:"extension" store row IS an origin — the store takes the bytes this release published', () => {
    const r = originEnvironments({ channels: [EXT_ROW] }, 'fullshot', ['fullshot-chromium.zip']);
    assert.deepEqual(r.environments, ['fullshot-chrome-webstore']);
    assert.deepEqual(r.omitted, []);
  });

  test('a kind:"store" row on the APP surface is still withheld — the rule did not widen', () => {
    const appStore = { ...EXT_ROW, id: 'android-play', surface: 'app', artifactFormats: ['.aab'], deploymentEnvironment: '{app}-android-play' };
    const r = originEnvironments({ channels: [appStore] }, 'subly', ['subly-v1-app-release.aab']);
    assert.deepEqual(r.environments, [], 'recording an app-store submission from a release would write a submission that never happened');
    assert.deepEqual(r.omitted, []);
  });

  test('an extension row whose format this release does NOT carry is not emitted', () => {
    const r = originEnvironments({ channels: [EXT_ROW] }, 'fullshot', ['subly-v1-app-release.aab']);
    assert.deepEqual(r.environments, []);
  });

  test('an extension row with an UNDECLARED signing posture is withheld, exactly as a direct row is', () => {
    const noSigning = { ...EXT_ROW, signing: { keyKind: 'mystery' } };
    const r = originEnvironments({ channels: [noSigning] }, 'fullshot', ['fullshot-chromium.zip']);
    assert.deepEqual(r.environments, []);
    assert.equal(r.omitted.length, 1);
    assert.equal(r.omitted[0].state, 'undeclared');
  });
});

describe('assert-release-durable.mjs — a job that cannot run on a tag is a build proof', () => {
  const TAGGED = [
    'name: three lanes in one file',
    'on:',
    '  push:',
    '    tags:',
    "      - '*-v*'",
    'jobs:',
    '  package:',
    '    IFLINE',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - uses: actions/upload-artifact@v7',
    '        with:',
    '          path: extensions/dist/*.zip',
    '          retention-days: 14',
    '',
  ].join(String.fromCharCode(10));

  const withIf = (line) => TAGGED.replace('    IFLINE', line);
  // `.zip` must be in the register or it is not an INSTALLABLE extension and the
  // classifier finds no upload at all — the guard's own coverage floor fires
  // first and the case would prove nothing.
  const EXT_REGISTER = {
    channels: [
      ...REGISTER.channels,
      {
        id: 'chrome-webstore',
        kind: 'store',
        surface: 'extension',
        served: false,
        artifactFormats: ['.zip'],
        deploymentEnvironment: '{app}-chrome-webstore',
        lane: { workflow: '.github/workflows/extensions.yml', job: 'package' },
        signing: { keyKind: 'none', identity: null },
      },
    ],
  };

  test('GREEN CONTROL — the package job carries the tag exclusion and is PRINTED, not failed', () => {
    const root = fixture({
      register: EXT_REGISTER,
      workflows: { 'extensions.yml': withIf("    if: github.event_name != 'schedule' && !startsWith(github.ref, 'refs/tags/')") },
    });
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /its own `if:` carries/);
  });

  test('THE MUTATION — delete the tag exclusion and the same job fails again, by name', () => {
    const root = fixture({
      register: EXT_REGISTER,
      workflows: { 'extensions.yml': withIf("    if: github.event_name != 'schedule'") },
    });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /job "package" uploads an installable artifact/);
  });

  test('a job with NO `if:` at all is graded — the narrowing is one condition, not a mood', () => {
    const root = fixture({ register: EXT_REGISTER, workflows: { 'extensions.yml': TAGGED.replace('    IFLINE' + String.fromCharCode(10), '') } });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /job "package" uploads an installable artifact/);
  });

  test('a STEP-level tag exclusion does not excuse the JOB — the shallowest `if:` is the job\'s', () => {
    const stepLevel = TAGGED
      .replace('    IFLINE' + String.fromCharCode(10), '')
      .replace('      - uses: actions/upload-artifact@v7', "      - if: \"!startsWith(github.ref, 'refs/tags/')\"" + String.fromCharCode(10) + '        uses: actions/upload-artifact@v7');
    const root = fixture({ register: EXT_REGISTER, workflows: { 'extensions.yml': stepLevel } });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
  });
});
