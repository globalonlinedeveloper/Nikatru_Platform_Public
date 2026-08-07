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
  expectedReleaseFormats,
  missingReleaseFormats,
  originEnvironments,
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

/** A register with one direct channel and one store channel — enough for the
 *  format derivation, limb 3 and originEnvironments to have real inputs. */
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
    },
  ],
};

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

const cli = (args) => {
  const r = spawnSync(process.execPath, [MANIFEST_SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
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
    assert.deepEqual(originEnvironments(REGISTER, 'subly', ['subly-v1-subly.msix']), ['subly-windows-direct']);
    // The .aab is carried, but android-play is a STORE row: a GitHub Release is
    // a download origin, never a submission.
    assert.deepEqual(originEnvironments(REGISTER, 'subly', ['subly-v1-app-release.aab']), []);
    // A direct row whose format is absent is not a channel this release served.
    assert.deepEqual(originEnvironments(REGISTER, 'subly', ['subly-v1-notes.txt']), []);
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

  test('the REAL register resolves to exactly what the release lane stages today', () => {
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    assert.deepEqual([...expectedReleaseFormats(real)].sort(), ['.aab', '.apk', '.msix']);
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
  const COMPLETE = ['subly-v1-app-release.apk', 'subly-v1-app-release.aab', 'subly-v1-subly.msix'];

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
    assert.match(r.out, /all 3 expected format\(s\) present: \.aab, \.apk, \.msix/);
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
    assert.match(r.out, /no `kind: "direct"` channel/);
  });

  test('--emit-environments resolves the real register to a real environment', () => {
    const d = join(TMP, `d${seq++}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'subly-v1-subly.msix'), 'msix');
    const r = cli(['--emit-environments', d, '--app', 'subly']);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.trim(), 'subly-windows-direct');
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
