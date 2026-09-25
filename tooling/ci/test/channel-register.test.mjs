// ─────────────────────────────────────────────────────────────────────────────
// channel-register.test.mjs — assert-channel-register.mjs must be able to FAIL.
//
// [pipeline R-5] the factory releases only to channels it has declared, and
// never a partial set. Nine acceptance criteria across stages 9 and 10 quantify
// over the served set this guard defends, so a guard that stopped checking would
// take all nine with it silently.
//
// ⚠️ THESE FIXTURES ARE THE SECOND LINE OF EVIDENCE, NOT THE FIRST. CLAUDE.md:
// "A fixture passing is not a guard working — MUTATE THE REAL TREE", because a
// fixture you wrote encodes the same misunderstanding as the guard you wrote.
// That is not theoretical here: the FIRST mutation run of this guard reported
// 14/14 caught and was WORTHLESS — the register was untracked, so the harness's
// `git checkout --` restore silently did nothing, mutations accumulated, and
// every result after the first was reading a leftover failure from the previous
// case. It was caught only by reading the failure MESSAGES and seeing them
// repeat. Re-run with a copy-based restore: 21 mutations against the real
// repository, 21 caught, each message read to confirm it failed for the intended
// reason. These tests keep that closed.
//
// Every case builds a fake tree and runs the real guard against it with the root
// passed as argv[2] — the guard resolves every path from there, so this exercises
// the real code with no stubbing.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseAllWorkflows, workflowSteps, shellSegments, joinShellContinuations } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-channel-register.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-chan-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const LANE_WORKFLOW = '.github/workflows/deploy-web.yml';
const BUILD_WORKFLOW = '.github/workflows/build-platforms.yml';
const EXT_WORKFLOW = '.github/workflows/extensions.yml';
/** A newline as a value — writing the escape into a generated string literal is
 *  how this repository has twice produced a file that would not parse. */
const NL = String.fromCharCode(10);
/** ⏱ 2026-09-24 — the gate the grader-is-run limb walks: ci.yml `ci-gate`, whose
 *  one need runs the fixture's grader. */
const GATE_CI = '.github/workflows/ci.yml';
const GATE_JOBS = [
  '  guards-store:',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - run: node tooling/ci/assert-store-metadata.mjs',
  '  ci-gate:',
  '    runs-on: ubuntu-24.04',
  '    needs: [guards-store]',
  '    if: always()',
  '    steps:',
  '      - run: echo gate',
  '',
].join(NL);

/** A lane workflow with one job, plus a decoy COMMENT naming a job that does not
 *  exist — so a guard that grepped prose instead of parsing jobs would resolve a
 *  lane against its own documentation. This repo has shipped that defect twice.
 *
 *  `laneBuilds:false` strips the build step: section 3b then has no artifact to
 *  compare the served row's formats against, which must be COVERAGE LOST rather
 *  than a quiet pass.
 *
 *  `laneSecrets` is section 8's ([9]R-3 limb 2) half. The COMMENT block below
 *  names `secrets.GHOST_SECRET`, and the run step mentions `scan-secrets.mjs`
 *  whose own filename contains the literal `secrets.mjs` — two decoys for a guard
 *  that text-greps `secrets.X` instead of extracting `${{ … }}` expressions from
 *  comment-stripped YAML. Both were real: the bare-grep version of this check
 *  reported a secret named `mjs` against the real tree. */
const laneWorkflow = ({ laneBuilds = true, releaseChannel = 'web', laneSecrets = [], laneExtraRun = [] } = {}) => `name: Deploy web
# The aggregating job all_platforms and the job ghost-job are named here in a
# comment only. Nothing below declares them. So is --dart-define=RELEASE_CHANNEL=ghost-channel,
# which must never be read as a stamp. Neither is \${{ secrets.GHOST_SECRET }}.
on:
  push:
jobs:
  deploy-web:
    name: Build & deploy
    runs-on: ubuntu-24.04
    steps:
      - run: node tooling/ci/scan-secrets.mjs .
${laneSecrets.map((n) => `      - run: echo "\${{ secrets.${n} }}"`).join('\n')}${laneSecrets.length ? '\n' : ''}${laneExtraRun.map((r) => `      - run: ${r}`).join('\n')}${laneExtraRun.length ? '\n' : ''}      - run: >
          ${typeof laneBuilds === 'string' ? laneBuilds : laneBuilds ? 'flutter build web --release' : 'echo deploy'}${releaseChannel === null ? '' : `
          --dart-define=RELEASE_CHANNEL=${releaseChannel}`}
`;

/** A build workflow shaped like the real one: three platform jobs plus an
 *  aggregator that needs all three and tests both verdicts. */
function buildWorkflow({
  needs = ['linux', 'windows', 'apple'],
  verdicts = ['failure', 'cancelled', 'skipped'],
  // 'expr' emits the real contains() expression; 'echo' merely SAYS the verdict
  // words — the shape the structural check exists to reject.
  verdictStyle = 'expr',
  exitOne = true,
  extraJob = '',
  // What the `windows` platform job runs. Deferred rows are compared against
  // whatever the tree already builds for their platform, so this is the knob
  // that creates the real .apk-vs-.aab shape in a fixture.
  windowsRun = 'echo windows',
} = {}) {
  const tests = verdicts
    .map((v) => `[ "\${{ contains(needs.*.result, '${v}') }}" = "true" ]`)
    .join(' || ');
  const aggBody =
    verdictStyle === 'echo'
      ? ['      - run: |', `          echo "would fail on ${verdicts.join(' or ')} here"`]
      : [
          '      - run: |',
          `          if ${tests}; then`,
          ...(exitOne ? ['            exit 1'] : ['            echo "detected but tolerated"']),
          '          fi',
        ];
  return [
    'name: Build',
    'on:',
    '  workflow_dispatch:',
    'jobs:',
    ...(extraJob ? [extraJob] : []),
    '  linux:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - run: echo linux',
    '  windows:',
    '    runs-on: windows-2025',
    '    steps:',
    `      - run: ${windowsRun}`,
    '  apple:',
    '    runs-on: macos-26',
    '    steps:',
    '      - run: echo apple',
    '  all_platforms:',
    '    runs-on: ubuntu-24.04',
    `    needs: [${needs.join(', ')}]`,
    '    if: always()',
    '    steps:',
    ...aggBody,
    '',
  ].join('\n');
}

const servedWeb = () => ({
  id: 'web',
  name: 'Web',
  surface: 'app',
  platforms: ['web'],
  kind: 'web',
  served: true,
  submittable: false,
  artifactFormats: ['static-bundle'],
  signing: {
    keyKind: 'none',
    identity: null,
    custody: 'the web channel signs nothing',
    seam: { prepare: null, verify: null, artifactGlob: null, why: 'the web channel signs nothing and has no store to submit to' },
    restoreDrill: { date: null, required: false, note: 'nothing of ours to restore' },
  },
  minimumToolchain: ['flutter'],
  lane: { workflow: LANE_WORKFLOW, job: 'deploy-web' },
  deploymentEnvironment: '{app}-web',
  storeMetadataDir: null,
  ownerQueue: null,
});

const deferredWindowsStore = () => ({
  id: 'windows-store',
  name: 'Microsoft Store',
  surface: 'app',
  platforms: ['windows'],
  kind: 'store',
  served: false,
  // §6c-ii (O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN): every native row answers it.
  nativeAuth: false,
  submittable: true,
  artifactFormats: ['.msix'],
  signing: {
    keyKind: 'none',
    identity: null,
    custody: 'the Store re-signs the MSIX',
    seam: { prepare: null, verify: null, artifactGlob: null, why: 'the Store re-signs the MSIX, so there is no key of ours to prepare or verify' },
    restoreDrill: { date: null, required: false, note: 'no key of ours' },
  },
  minimumToolchain: ['flutter'],
  lane: null,
  deploymentEnvironment: '{app}-windows-store',
  storeMetadataDir: 'apps/{app}/store/windows-store',
  ownerQueue: 'A-2',
  // [10]D-4's agent slice, added 2026-08-03. `ownerQueue` is a pointer into a
  // file CI can never open (it moved to nikatru/, a separate private repo), so this is the only place
  // a machine can answer "does a publisher account exist for this channel?".
  // Owner-asserted and dated because it cannot be derived; the guard holds it
  // to a RELATIONSHIP — served ⇒ verified, everything else PRINTS.
  accountStatus: { status: 'none', asOf: '2026-08-03', note: 'no Partner Center account' },
});

/** [10]D-10 limb (i)'s fixture: a submission workflow whose `dry-run` job really
 *  runs the script, plus a `gate` job that really does not. The second one is
 *  what makes "the job never invokes that script" a case that can be written. */
const SUBMIT_WORKFLOW = '.github/workflows/submit-thing.yml';
const SUBMIT_SCRIPT = 'tooling/release/submit-thing.mjs';
const submitWorkflow = ({ jobRunsScript = true } = {}) =>
  [
    'name: Submit',
    'on:',
    '  workflow_dispatch:',
    'jobs:',
    '  gate:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - run: node tooling/ci/assert-gate-passed.mjs',
    '  dry-run:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    `      - run: ${jobRunsScript ? `node ${SUBMIT_SCRIPT} --dry-run` : 'echo nothing'}`,
    '',
  ].join('\n');

/** `submission.recipeScript`'s fixture — the PACKAGING half of a submission
 *  path. It lives in a workflow of its own on purpose: the real one is produced
 *  in the BUILD lane, beside the bundle it describes, while the upload happens
 *  in the submission workflow, and a fixture that ran both from one file could
 *  not tell "some workflow invokes it" from "the submission job invokes it".
 *
 *  `invoked:false` keeps the file but replaces the call with a COMMENT naming
 *  it. That is the decoy this repo has already shipped twice: a bare text scan
 *  reads its own documentation as an invocation, so a commented-out packaging
 *  step would report as wired. */
const RECIPE_SCRIPT = 'tooling/release/generate-thing.mjs';
const PACKAGE_WORKFLOW = '.github/workflows/package-thing.yml';
const packageWorkflow = ({ invoked = true } = {}) =>
  [
    'name: Package',
    'on:',
    '  workflow_dispatch:',
    'jobs:',
    '  package:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    invoked ? `      - run: node ${RECIPE_SCRIPT} --app subscriptiontracker` : `      # - run: node ${RECIPE_SCRIPT} --app subscriptiontracker`,
    invoked ? '' : '      - run: echo nothing',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n')
    .concat('\n');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9's fixtures — the register's Android signing declaration vs the REAL
// build file. Off by default (`withAndroid`), so the ~50 cases above keep their
// exact output and a failure here can only be section 9.
const ANDROID_ID = 'android-play';
const ANDROID_SECRETS = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];
const GRADLE_TEMPLATE = 'apps/{app}/android/app/build.gradle.kts';

const extensionStore = () => ({
  id: 'chrome-webstore',
  name: 'Chrome Web Store',
  surface: 'extension',
  platforms: ['chrome'],
  kind: 'store',
  storefrontKey: null,
  served: false,
  submittable: false,
  purchaseRail: {
    rail: 'paddle',
    why: 'the store cannot take the money',
    forbids: ['play-billing', 'apple-iap'],
    forbidsWhy: 'no billing SDK exists in a browser extension',
    source: '[ADR 069] D1',
  },
  artifactFormats: ['.zip'],
  signing: {
    keyKind: 'none',
    identity: null,
    custody: 'the store re-signs',
    restoreDrill: { date: null, required: false, note: 'nothing of ours to restore' },
    seam: { prepare: null, verify: null, artifactGlob: 'extensions/dist/*.zip', why: 'nothing of ours signs this artifact' },
  },
  minimumToolchain: ['flutter'],
  deploymentEnvironment: '{app}-chrome-webstore',
  storeMetadataDir: 'extensions/Extension/{tool}/store/chrome',
  extensionStoreKey: 'chrome',
  extensionRedirectUri: null,
  ownerQueue: null,
  accountStatus: { status: 'live', asOf: '2026-08-12', note: 'publisher account open' },
  deferral: { reason: 'never submitted', alsoBlockedBy: null },
});

const androidPlay = () => ({
  id: ANDROID_ID,
  name: 'Google Play',
  surface: 'app',
  platforms: ['android'],
  kind: 'store',
  served: false,
  nativeAuth: false,
  submittable: true,
  artifactFormats: ['.aab'],
  signing: {
    keyKind: 'upload-key',
    identity: 'release-keystore/release.keystore',
    custody: 'recorded in the private SSoT',
    seam: { prepare: null, verify: null, artifactGlob: null, why: 'fixture channel: the seam is declared with nulls so the shape is present and explained' },
    restoreDrill: { date: '2026-08-04', required: true, note: 'drilled' },
    ciSecrets: {
      names: [...ANDROID_SECRETS],
      // §8b, as of 2026-08-08: every declared signing secret carries a written
      // reason, the same rule `ciSecretRegister.nonSigning` entries have always
      // had. Built from the name list rather than typed out, so a case that adds
      // a name to `names` cannot fail on a missing `why` it did not mean to test.
      why: Object.fromEntries(
        ANDROID_SECRETS.map((n) => [n, `${n} carries part of the release signing identity into CI`]),
      ),
      gradleContract: {
        declaredIn: GRADLE_TEMPLATE,
        envMap: 'releaseSigningEnv',
        signingConfig: 'release',
        buildType: 'release',
        transport: {
          name: 'ANDROID_KEYSTORE_BASE64',
          substitutes: 'storeFile',
          why: 'Gradle wants a filesystem path and a path cannot travel through a repository secret',
        },
      },
    },
  },
  minimumToolchain: ['flutter'],
  lane: null,
  deploymentEnvironment: '{app}-android-play',
  storeMetadataDir: 'apps/{app}/store/android-play',
  ownerQueue: 'S-5',
  accountStatus: { status: 'none', asOf: '2026-08-03', note: 'no Play developer account' },
});

/** A build file shaped like the real one — INCLUDING a decoy header comment that
 *  names the map, a fourth variable that does not exist, the signing config and
 *  an assignment. All four are the strings a text scan would look for, and none
 *  of them is code. The real file's header is 60 such lines.
 *
 *  🔴 `useMap:false` is the case that matters most: the `val` declaration stays
 *  EXACTLY as written and every consumer of it is deleted. A guard anchored on a
 *  symbol's own declaration passes that, which is how assert-seams-wired.mjs
 *  shipped green after every caller was removed. */
const gradleFile = ({
  envMap = 'releaseSigningEnv',
  pairs = [
    ['storeFile', 'ANDROID_KEYSTORE_PATH'],
    ['storePassword', 'ANDROID_KEYSTORE_PASSWORD'],
    ['keyAlias', 'ANDROID_KEY_ALIAS'],
    ['keyPassword', 'ANDROID_KEY_PASSWORD'],
  ],
  assigns = null,
  useMap = true,
  wireBuildType = true,
  commentOutMap = false,
  signingConfig = 'release',
} = {}) => {
  const map = [
    `val ${envMap} = mapOf(`,
    ...pairs.map(([k, v]) => `    "${k}" to "${v}",`),
    ')',
  ];
  const assigned = assigns ?? pairs.map(([k]) => k);
  return [
    '// 🔴 DECOY. Every string a prose scan would match lives in this comment and',
    '// nowhere else in the file:',
    `//     val ${envMap} = mapOf("keyAlias" to "GHOST_VARIABLE")`,
    `//     signingConfigs.getByName("${signingConfig}")`,
    '//     keyAlias = signingValue("keyAlias")',
    'import java.util.Properties',
    '',
    ...(commentOutMap ? map.map((l) => `// ${l}`) : map),
    '',
    ...(useMap
      ? [
          `val suppliedSigningKeys = ${envMap}.keys.filter { signingValue(it) != null }`,
          `val hasReleaseSigning = suppliedSigningKeys.size == ${envMap}.size`,
        ]
      : ['val hasReleaseSigning = false']),
    '',
    'android {',
    '    signingConfigs {',
    '        if (hasReleaseSigning) {',
    `            create("${signingConfig}") {`,
    ...assigned.map((k) => `                ${k} = signingValue("${k}")`),
    '            }',
    '        }',
    '    }',
    '    buildTypes {',
    '        release {',
    '            signingConfig =',
    '                if (hasReleaseSigning) {',
    // 🔒 The debug branch is IDENTICAL in both arms. Breaking the wiring must not
    // be expressible as "delete the fallback" — that fallback is a recorded owner
    // decision and tooling/release/submit-play.mjs already fails its removal.
    `                    ${wireBuildType ? `signingConfigs.getByName("${signingConfig}")` : 'null'}`,
    '                } else {',
    '                    signingConfigs.getByName("debug")',
    '                }',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
};

/**
 * Build a fixture repo. Everything is valid unless a knob says otherwise.
 * `mutate(register)` breaks exactly one thing, so a failure is attributable.
 */
/* Which Flutter build verb emits which fixture format. Anything a mutation invents
   falls back to 'web' so the register stays well formed and the test fails on the
   thing it is testing rather than on a missing verb. */
const FIXTURE_BUILD_VERB = { 'static-bundle': 'web', '.msix': 'windows', '.aab': 'appbundle' };
/* §10 limb (iii) — `packagedBy` DEFAULTS TO THE NOT-IMPLEMENTED SENTINEL in every
   fixture, because a fixture tree packages nothing: the only build step any of
   these workflows runs is `flutter build web` in the lane, so every format but
   `static-bundle` is emitted by no lane. Defaulting to `null` (what this file did
   until 2026-08-25) made the ~50 cases above red on a limb none of them is about.
   The `packagedBy` knob overrides one format, and it is the knob the limb's own
   cases turn — including back to `null`, which the limb treats as a claim and not
   as an absence. */
const FIXTURE_UNPACKAGED =
  '\u{1F534} NOT IMPLEMENTED ANYWHERE IN THIS REPOSITORY \u2014 a fixture tree runs no packaging step.';

function tree({
  mutate = null,
  breakArtifactBuild = null,
  platforms = ['web'],
  omitRegister = false,
  registerRaw = null,
  needs = ['linux', 'windows', 'apple'],
  verdicts = ['failure', 'cancelled', 'skipped'],
  verdictStyle = 'expr',
  exitOne = true,
  extraJob = '',
  windowsRun = 'echo windows',
  laneBuilds = true,
  releaseChannel = 'web',
  // [9]R-3 limb 2 (section 8): which `${{ secrets.X }}` the lane workflow names.
  laneSecrets = [],
  // ⏱ ADDED 2026-09-22 (limb 6b-iv). Extra `- run:` steps in the lane job, so a
  // fixture can carry a SECOND channel stamp — or a `--channel` argument — in a
  // job whose register row is known. Pairing is a property of (job, channel),
  // and one stamp per fixture could not express it.
  laneExtraRun = [],
  // ── section 9 ──────────────────────────────────────────────────────────────
  // `withAndroid` adds the android-play row (which carries a `gradleContract`)
  // AND the build file it points at. Both off by default.
  withAndroid = false,
  gradle = {},
  omitGradleFile = false,
  adrLocked = true,
  adrOnDisk = true,
  // `Private/` is gitignored, so a CI checkout has no harness at all. The ADR
  // check is decided by this ROOT, never by the individual file — see the guard.
  harnessPresent = true,
  // [10]D-10 limb (i). Off by default so every existing case keeps its exact
  // output; the submission suite turns it on.
  withSubmission = false,
  submissionScriptOnDisk = true,
  submissionWorkflowOnDisk = true,
  jobRunsScript = true,
  // The PACKAGING half of a submission block. Off by default for the same
  // reason `withSubmission` is: every existing case keeps its exact output.
  withRecipeScript = false,
  recipeScriptOnDisk = true,
  recipeScriptInvoked = true,
  // ── the extension surface (2026-09-05) ─────────────────────────────────────
  // `withExtension` adds ONE `surface: "extension"` store row AND the extensions
  // subtree its `storeMetadataDir` template must resolve into. Both off by
  // default so every existing case keeps its exact output.
  withExtension = false,
  // The browsers extensions/scripts/schema/tool.schema.json declares; `null`
  // writes no schema file at all.
  extensionSchemaBrowsers = ['chrome', 'edge', 'firefox'],
  extensionToolDirs = ['Full_Screen_Shot'],
  omitExtensionStoreDir = false,
  toolJsonStores = null,       // null = derive from the row's extensionStoreKey
  // tool.json declares which stores a pack target reaches TWICE — forward as
  // `targets.<t>.stores` and backwards as `storeMetadata.stores.<k>.target` —
  // and assert-channel-register derives its pack-target map from them, so it
  // holds the two equal. `null` writes the agreeing pair; a value here replaces
  // the forward half and is how the disagreement is exercised.
  toolJsonTargets = null,
  // `extensionLane` gives the row a lane in a workflow this fixture writes.
  // `extensionLaneBuilds:false` strips the `pack.mjs --target` step, so section
  // 3b resolves NO emitted format for any browser — which must be COVERAGE LOST
  // rather than a quiet pass, exactly as `laneBuilds:false` is on the app side.
  extensionLane = false,
  extensionLaneBuilds = true,
  // §10 limb (iii): per-format override of `artifactBuild.formats[f].packagedBy`.
  // `{ '.msix': null }` is a real case — the limb holds null to the same sentinel
  // as prose — so membership, not truthiness, decides whether the default applies.
  packagedBy = {},
  // Extra files written into the fixture root, for cases that need a real ADR
  // on disk beside the harness marker.
  extraFiles = {},
  // Limb 6b-iii's cross-check: what tooling/capability-register.json lists as
  // `vendors.revenuecat.surfaces`. `null` writes no capability register at all.
  revenuecatSurfaces = ['REVENUECAT_KEY'],
  // ⏱ 2026-09-24 — the grader-is-run limb walks ci.yml `ci-gate`, and skips a
  // fixture root with no ci.yml. A case that hands in its own ci.yml gets the two
  // gate jobs appended unless it declares `ci-gate` itself (or passes gate: false),
  // so every existing case keeps its verdict.
  gate = true,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    aggregatingJob: { workflow: BUILD_WORKFLOW, job: 'all_platforms' },
    // ⚠️ REQUIRED IN THE FIXTURE. The guard derives its signing-key vocabulary
    // from here rather than carrying a second copy ([pipeline F-2]), so a
    // fixture without `keyKinds` is COVERAGE LOST — which is the point.
    // ⚠️ REQUIRED IN THE FIXTURE FOR THE SAME REASON `keyKinds` IS. The guard
    // derives the surface vocabulary AND each surface's platform names from the
    // register ([pipeline F-2]), so a fixture without this block is COVERAGE
    // LOST — which several cases below assert deliberately.
    surfaces: {
      app: {
        what: 'a Flutter application delivered to a device',
        flutterApp: true,
        platforms: ['android', 'ios', 'linux', 'macos', 'web', 'windows'],
        platformsSource: "Flutter's own target names",
        storeMetadataGradedBy: 'tooling/ci/assert-store-metadata.mjs',
      },
    },
    keyKinds: {
      none: 'the channel signs for us — nothing of ours can be lost',
      'upload-key': 'we sign the upload; the store holds the real app signing key',
      'app-signing-key': "we hold the key end users' installs are bound to",
      'distribution-certificate': 'an Apple distribution certificate + provisioning profile',
      'code-signing-certificate': 'a CA-issued certificate chaining to a trusted root',
      'own-signing-key': 'our own detached signature, no gatekeeper verifying it',
    },
    channels: [servedWeb(), deferredWindowsStore()],
    // ⚠️ REQUIRED IN THE FIXTURE, for the reason `keyKinds` is: limb 6b-iii reads
    // the store-key define and its secret map from here rather than carrying a
    // second copy, so a fixture without it is COVERAGE LOST. The rows above carry
    // no `purchaseRail`, so by default no fixture segment is a store segment and
    // the define is simply forbidden everywhere — every existing case keeps its
    // exact verdict; the 6b-iii suite adds the rails it needs.
    purchaseRails: {
      rails: {
        paddle: 'the hosted web checkout',
        'play-billing': 'Google Play Billing, through RevenueCat',
        'apple-iap': 'Apple in-app purchase, through RevenueCat',
        none: 'this channel sells nothing',
      },
      storeKeyDefine: {
        define: 'REVENUECAT_KEY',
        secretByRail: { 'play-billing': 'REVENUECAT_PUBLIC_KEY_GOOGLE', 'apple-iap': 'REVENUECAT_PUBLIC_KEY_APPLE' },
      },
    },
    disqualified: [
      {
        id: 'flathub',
        name: 'Flathub',
        platforms: ['linux'],
        adr: 'Private/decisions/015-linux-distribution-channel.md',
        date: '2026-07-25',
        ownerQueue: 'A-5',
        reason: ['bans AI-assisted code'],
      },
    ],
    nonChannelSigningIdentities: [],
    // ⏱ 2026-09-22 — the 6b-ii exemptions live in the REGISTER now (they were a
    // `const` in the guard). Both real entries are carried; a fixture root that
    // does not contain the named workflow skips its staleness check, so only the
    // 6b-ii cases that write ci.yml exercise it.
    releaseBuildsNeverShipped: {
      _why: ['builds whose output is thrown away — fixture copy of the real key'],
      entries: [
        {
          workflow: '.github/workflows/ci.yml',
          job: 'app-brick',
          target: 'web',
          why: 'the BRICK smoke build — proves a freshly stamped app compiles; the output is discarded in the same job.',
        },
        {
          workflow: '.github/workflows/symbolication-proof.yml',
          job: 'prove',
          target: 'apk',
          why: 'the crash-probe apk — built to prove symbolication end to end and thrown away with the runner.',
        },
      ],
    },
  };
  if (withSubmission) {
    register.channels[1].submission = {
      script: SUBMIT_SCRIPT,
      workflow: SUBMIT_WORKFLOW,
      job: 'dry-run',
      runbook: 'company/runbooks/store-submission-thing.md',
    };
    if (withRecipeScript) register.channels[1].submission.recipeScript = RECIPE_SCRIPT;
  }
  // Pushed BEFORE `mutate` so the existing knob can break section 9's row the
  // same way it breaks every other one — one mutation, one attributable failure.
  if (withAndroid) register.channels.push(androidPlay());
  if (withExtension) {
    register.surfaces.extension = {
      what: 'a browser extension shipped from extensions/',
      flutterApp: false,
      platforms: ['chrome', 'edge', 'firefox'],
      platformsSource: 'the browser names',
      storeMetadataGradedBy: 'tooling/ci/assert-store-metadata.mjs',
    };
    const extRow = extensionStore();
    if (extensionLane) extRow.lane = { workflow: EXT_WORKFLOW, job: 'release' };
    register.channels.push(extRow);
  }
  if (mutate) mutate(register);
  // §10 — DERIVED FROM THE CHANNELS AFTER `mutate`, NEVER TYPED.
  // It must be derived AFTER, because several tests mutate a channel's
  // artifactFormats: deriving first left the table describing the pre-mutation
  // channels and failed those tests for a second, unrelated reason. A fixture
  // that types this table cannot survive both directions of the guard's check.
  // `breakArtifactBuild` is the deliberate escape hatch, so §10 can still be
  // negative-tested without any test having to hand-write the whole table.
  // A format declared ONLY by extension rows is built by the packer, not by
  // Flutter, and the real register writes it that way: `surface: "extension"`
  // plus a `packVerb`, never a `flutterTarget`. It has to be written that way
  // here too, because assert-channel-register derives the extension surface's
  // format set from exactly these entries — a fixture that omits the surface
  // makes the pack-target map carry no formats and the extension half of §3b
  // then reports COVERAGE LOST for the fixture's own shape.
  const extOnlyFormats = new Set(
    register.channels.filter((c) => c.surface === 'extension').flatMap((c) => c.artifactFormats ?? []),
  );
  for (const c of register.channels) {
    if (c.surface === 'extension') continue;
    for (const f of c.artifactFormats ?? []) extOnlyFormats.delete(f);
  }
  register.artifactBuild = {
    formats: Object.fromEntries(
      [...new Set(register.channels.flatMap((c) => c.artifactFormats ?? []))].map((f) => [
        f,
        extOnlyFormats.has(f)
          ? {
              surface: 'extension',
              packVerb: 'node extensions/scripts/pack.mjs fullshot --target chromium --out dist',
              packagedBy: Object.prototype.hasOwnProperty.call(packagedBy, f) ? packagedBy[f] : FIXTURE_UNPACKAGED,
            }
          : {
              flutterTarget: FIXTURE_BUILD_VERB[f] ?? 'web',
              packagedBy: Object.prototype.hasOwnProperty.call(packagedBy, f) ? packagedBy[f] : FIXTURE_UNPACKAGED,
            },
      ]),
    ),
  };
  if (breakArtifactBuild) breakArtifactBuild(register);

  // 🔴 DERIVED FROM THE REGISTER AFTER THE MUTATION, never typed. A case that
  // renames a secret HERE would otherwise leave the lane naming the old one, and
  // section 8 would fail alongside section 9 — two messages for one mutation, and
  // a red result nobody can attribute. Deriving keeps section 8 silent throughout.
  const androidNames = withAndroid
    ? (register.channels.find((c) => c.id === ANDROID_ID)?.signing?.ciSecrets?.names ?? []).filter((n) => typeof n === 'string')
    : [];

  write('catalog/apps.json', JSON.stringify([{ slug: 'subscriptiontracker', platforms, status: 'live' }]));
  write('tooling/versions.json', JSON.stringify({ flutter: '3.44.8', wrangler: '4.114.0', java: '17' }));
  if (withExtension) {
    // The subtree the extension row's `storeMetadataDir` template must resolve
    // into, for EVERY tool — the guard walks extensions/Extension and checks each
    // one, so a second tool directory is how the per-tool loop is exercised.
    const row = register.channels.find((c) => c.surface === 'extension');
    const key = row?.extensionStoreKey ?? 'chrome';
    for (const tool of extensionToolDirs) {
      const stores = toolJsonStores ?? { [key]: { target: 'chromium', dir: `store/${key}`, served: false } };
      // The forward declaration, derived from the reverse one so the pair agrees
      // unless a case deliberately breaks it.
      const derivedTargets = {};
      for (const [k, v] of Object.entries(stores)) {
        const t = v?.target ?? 'chromium';
        derivedTargets[t] = { stores: [...(derivedTargets[t]?.stores ?? []), k] };
      }
      const targets = toolJsonTargets ?? derivedTargets;
      write(
        `extensions/Extension/${tool}/tool.json`,
        JSON.stringify({ id: tool.toLowerCase(), surface: 'extension', targets, storeMetadata: { stores } }, null, 2),
      );
      if (!omitExtensionStoreDir) write(`extensions/Extension/${tool}/store/${key}/README.md`, 'listing');
    }
    // The source `surfaces.extension.platforms` is held to (O-EXT-SURFACE-AXIS).
    // Written to agree with the fixture register unless a case overrides it.
    if (extensionSchemaBrowsers !== null) {
      write(
        'extensions/scripts/schema/tool.schema.json',
        JSON.stringify({
          properties: { listings: { properties: Object.fromEntries(extensionSchemaBrowsers.map((b) => [b, { type: 'object' }])) } },
        }),
      );
    }
    if (extensionLane) {
      write(
        EXT_WORKFLOW,
        [
          'name: extensions',
          'on:',
          '  push:',
          '    tags: [subscriptiontracker-v1]',
          'jobs:',
          '  release:',
          '    runs-on: ubuntu-24.04',
          '    steps:',
          '      - name: Build package',
          extensionLaneBuilds ? '        run: node scripts/pack.mjs fullshot --target chromium --out dist' : '        run: echo nothing',
          '',
        ].join(NL),
      );
    }
  }
  // The surface vocabulary names the guard that grades each surface's listing
  // trees, and the register guard checks that guard EXISTS — a surface pointing
  // at a deleted grader reads as covered. A stub is enough: nothing here runs it.
  write('tooling/ci/assert-store-metadata.mjs', '// fixture stub — presence is the only property asserted');
  write(LANE_WORKFLOW, laneWorkflow({ laneBuilds, releaseChannel, laneSecrets: [...laneSecrets, ...androidNames], laneExtraRun }));
  if (withAndroid && !omitGradleFile) write(GRADLE_TEMPLATE.split('{app}').join('subscriptiontracker'), gradleFile(gradle));
  write(BUILD_WORKFLOW, buildWorkflow({ needs, verdicts, verdictStyle, exitOne, extraJob, windowsRun }));
  if (harnessPresent) {
    // The harness root exists even when the cited ADR does not — that is the
    // distinction the guard turns on, and the case a blanket existsSync() skip
    // would have thrown away.
    // ⚠️ The fixture ADR filenames here and in the signing-identity suite below are
    // the REAL ones (`015-linux-distribution-channel.md`, `022-pack-signing-key-custody.md`).
    // They were invented short forms — `015-linux.md`, `022-pack.md` — until 2026-08-17,
    // which no guard could see because a fixture path is only ever written and read by
    // this file. assert-public-citations.mjs now checks every `Private/...` named in the
    // public tree, so a made-up path fails the build. Do not shorten them back.
    write('Private/decisions/README.md', 'the harness is checked out\n');
    if (adrOnDisk) {
      write('Private/decisions/015-linux-distribution-channel.md', adrLocked ? '# 015\n**Status:** LOCKED 2026-07-25\n' : '# 015\n**Status:** proposed\n');
    }
  }
  if (withSubmission) {
    if (submissionScriptOnDisk) write(SUBMIT_SCRIPT, '// the submission path\n');
    if (submissionWorkflowOnDisk) write(SUBMIT_WORKFLOW, submitWorkflow({ jobRunsScript }));
    if (withRecipeScript) {
      if (recipeScriptOnDisk) write(RECIPE_SCRIPT, '// the packaging path\n');
      write(PACKAGE_WORKFLOW, packageWorkflow({ invoked: recipeScriptInvoked }));
    }
  }
  if (revenuecatSurfaces !== null) {
    write('tooling/capability-register.json', JSON.stringify({ vendors: { revenuecat: { surfaces: revenuecatSurfaces } } }, null, 2));
  }
  for (const [rel, body] of Object.entries(extraFiles)) {
    write(rel, gate && rel === GATE_CI && !/^ {2}ci-gate:/m.test(body) ? `${body.replace(/\n*$/, '')}${NL}${GATE_JOBS}` : body);
  }
  if (!omitRegister) {
    write('tooling/channel-register.json', registerRaw ?? JSON.stringify(register, null, 2));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — the served set exists and is honest', () => {
  test('PASSES on a register whose claims all resolve to a served channel', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /assert-channel-register: ok/);
  });

  // ── the recorded failing case from [9]R-5's replacement acceptance ─────────
  test('FAILS when an app claims a platform whose only rows are NOT served', () => {
    const { code, out } = run(tree({ platforms: ['web', 'windows'] }));
    assert.equal(code, 1, out);
    assert.match(out, /claims "windows"/);
    assert.match(out, /NOT SERVED/);
  });

  test('FAILS when an app claims a platform with no register row at all', () => {
    const { code, out } = run(tree({ platforms: ['web', 'linux'] }));
    assert.equal(code, 1, out);
    assert.match(out, /no row for it at all/);
  });

  // ── direction B: a served channel nobody ships to is fiction ───────────────
  test('FAILS when a served channel is claimed by no app', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => {
          const w = r.channels.find((c) => c.id === 'windows-store');
          w.served = true;
          w.lane = { workflow: LANE_WORKFLOW, job: 'deploy-web' };
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /SERVED and declares platform/);
  });
});

describe('assert-channel-register — COVERAGE LOST is the loud case', () => {
  test('FAILS COVERAGE LOST when the register does not exist', () => {
    const { code, out } = run(tree({ omitRegister: true }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /does not exist/);
  });

  test('FAILS COVERAGE LOST when the register declares zero channels', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels = []; } }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO channels/);
  });

  test('FAILS COVERAGE LOST when no channel is served', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels.forEach((c) => { c.served = false; }); } }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NONE is served/);
  });

  test('FAILS COVERAGE LOST when an app claims an empty platform set', () => {
    const { code, out } = run(tree({ platforms: [] }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO platform claims/);
  });

  test('FAILS COVERAGE LOST when the register is not valid JSON', () => {
    const { code, out } = run(tree({ registerRaw: '{ "channels": [ ' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
  });
});

describe('assert-channel-register — what SERVED obliges a row to carry', () => {
  const servedMutation = (fn) => tree({ mutate: (r) => fn(r.channels.find((c) => c.id === 'web')) });

  test('FAILS when a served lane names a job the workflow does not declare', () => {
    const { code, out } = run(servedMutation((c) => { c.lane.job = 'ghost-job'; }));
    assert.equal(code, 1, out);
    assert.match(out, /claims lane job "ghost-job"/);
  });

  // The lane workflow names `ghost-job` in a COMMENT. A guard grepping prose
  // would resolve the lane above against its own documentation and pass.
  test('does not resolve a lane job from a COMMENT that names it', () => {
    const { out } = run(servedMutation((c) => { c.lane.job = 'ghost-job'; }));
    assert.match(out, /which declares \[deploy-web\]/);
  });

  test('FAILS when a served lane names a workflow that does not exist', () => {
    const { code, out } = run(servedMutation((c) => { c.lane.workflow = '.github/workflows/nope.yml'; }));
    assert.equal(code, 1, out);
    assert.match(out, /which does not exist/);
  });

  test('FAILS when a served channel has no lane at all', () => {
    const { code, out } = run(servedMutation((c) => { c.lane = null; }));
    assert.equal(code, 1, out);
    assert.match(out, /names no `lane`/);
  });

  // ── a DEFERRED row's lane is checked too (hardened 2026-08-01) ─────────────
  // Lane resolution used to live entirely inside the `served === true` branch,
  // which was harmless only while every deferred lane was null. [10]D-5/D-10
  // build a channel's lane BEFORE its account exists — windows-store emits the
  // .msix today with served:false — so a deferred lane naming a job nobody wrote
  // is a lane that runs nothing, and §3b silently reads an EMPTY job body for it
  // and reports "nothing to compare", which prints as a pass.
  const deferredMutation = (fn) => tree({ mutate: (r) => fn(r.channels.find((c) => c.id === 'windows-store')) });

  test('PASSES when a DEFERRED row names a lane that resolves', () => {
    const { code, out } = run(deferredMutation((c) => { c.lane = { workflow: BUILD_WORKFLOW, job: 'windows' }; }));
    assert.equal(code, 0, out);
  });

  test('FAILS when a DEFERRED row names a lane JOB that does not exist', () => {
    const { code, out } = run(deferredMutation((c) => { c.lane = { workflow: BUILD_WORKFLOW, job: 'ghost-job' }; }));
    assert.equal(code, 1, out);
    assert.match(out, /is deferred and claims lane job "ghost-job"/);
  });

  test('FAILS when a DEFERRED row names a lane WORKFLOW that does not exist', () => {
    const { code, out } = run(deferredMutation((c) => { c.lane = { workflow: '.github/workflows/nope.yml', job: 'windows' }; }));
    assert.equal(code, 1, out);
    assert.match(out, /is deferred and its lane names .*nope\.yml, which does not exist/);
  });

  test('FAILS on a malformed lane — it resolves to nothing and looks like coverage', () => {
    const { code, out } = run(deferredMutation((c) => { c.lane = { workflow: BUILD_WORKFLOW }; }));
    assert.equal(code, 1, out);
    assert.match(out, /names a `lane` that is not \{workflow: string, job: string\}/);
  });

  test('still PASSES when a deferred row names NO lane — that is the expected state', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
  });

  test('FAILS when a served channel names a toolchain key versions.json does not pin', () => {
    const { code, out } = run(servedMutation((c) => { c.minimumToolchain = ['xcode']; }));
    assert.equal(code, 1, out);
    assert.match(out, /does not pin/);
  });

  test('FAILS when a served channel has an EMPTY toolchain floor', () => {
    const { code, out } = run(servedMutation((c) => { c.minimumToolchain = []; }));
    assert.equal(code, 1, out);
    assert.match(out, /EMPTY toolchain floor/);
  });

  test('FAILS when a served channel loses its {app} deployment-environment template', () => {
    const { code, out } = run(servedMutation((c) => { c.deploymentEnvironment = 'subscriptiontracker-web'; }));
    assert.equal(code, 1, out);
    assert.match(out, /deploymentEnvironment/);
  });

  test('FAILS when a served channel declares no artifact format', () => {
    const { code, out } = run(servedMutation((c) => { c.artifactFormats = []; }));
    assert.equal(code, 1, out);
    assert.match(out, /no `artifactFormats`/);
  });

  test('FAILS when a served channel holds a real key with no DATED restore drill', () => {
    const { code, out } = run(
      servedMutation((c) => {
        c.signing.keyKind = 'upload-key';
        c.signing.restoreDrill = { date: null, required: true, note: 'never drilled' };
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /no DATED restore drill/);
  });

  // ⚠️ `ciSecrets` + `laneSecrets` are REQUIRED here as of 2026-08-06 and this is
  // section 8 ([9]R-3 limb 2) working, not fixture noise: a row that holds a real
  // key AND has a lane must say which secrets carry that key into CI. Without the
  // pair, this "everything a served row must carry" fixture was carrying a key
  // with no declared way to use it — which is the state the real android-play row
  // was in for the two days `signing.ciSecrets` existed with no reader.
  const withUploadKey = (c) => {
    c.signing.keyKind = 'upload-key';
    c.signing.identity = 'release-keystore/upload.keystore';
    c.signing.ciSecrets = {
      names: ['FIXTURE_UPLOAD_KEY'],
      why: { FIXTURE_UPLOAD_KEY: 'the fixture keystore this served row signs with' },
    };
  };
  const laneNamesIt = { laneSecrets: ['FIXTURE_UPLOAD_KEY'] };

  test('PASSES a served channel whose key IS drilled, with a date', () => {
    const { code, out } = run(
      tree({
        ...laneNamesIt,
        mutate: (r) => {
          const c = r.channels.find((x) => x.id === 'web');
          withUploadKey(c);
          c.signing.restoreDrill = { date: '2026-07-31', required: true, note: 'drilled' };
        },
      }),
    );
    assert.equal(code, 0, out);
  });

  // ── review 2026-07-31 hardening: the audited row cannot waive its own audit ──
  test('FAILS when a served real-key row waives its drill via required:false', () => {
    const { code, out } = run(
      servedMutation((c) => {
        c.signing.keyKind = 'upload-key';
        c.signing.identity = 'release-keystore/upload.keystore';
        c.signing.restoreDrill = { date: null, required: false, note: 'waived' };
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /cannot waive that/);
  });

  test('FAILS when a served real-key row names no identity — R-3 says ENUMERATED', () => {
    const { code, out } = run(
      servedMutation((c) => {
        c.signing.keyKind = 'upload-key';
        c.signing.identity = null;
        c.signing.restoreDrill = { date: '2026-07-31', required: true, note: 'drilled' };
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /no `signing\.identity`/);
  });

  test('FAILS when keyKind none carries a named identity — a contradiction', () => {
    const { code, out } = run(servedMutation((c) => { c.signing.identity = 'ghost.pem'; }));
    assert.equal(code, 1, out);
    assert.match(out, /keyKind "none" but a non-null/);
  });

  test('FAILS when a SERVED row grows a platform no app claims (partial orphan)', () => {
    // The register's headline guarantee, from the register side: the old check
    // fired only when EVERY platform was orphaned, so this exact edit passed.
    const { code, out } = run(servedMutation((c) => { c.platforms.push('windows'); }));
    assert.equal(code, 1, out);
    assert.match(out, /declares platform "windows", which no app/);
  });

  // A DEFERRED row with the same gap must PRINT, never fail — the standing rule
  // for owner-gated work (assert-seams-wired.mjs, [pipeline C-6]). Apple's real
  // Xcode 26 floor is exactly this case.
  test('PRINTS rather than fails when a DEFERRED channel names an unpinned toolchain', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels.find((c) => c.id === 'windows-store').minimumToolchain = ['xcode']; } }));
    assert.equal(code, 0, out);
    assert.match(out, /deferred\) needs a pinned `xcode`/);
  });
});

describe('assert-channel-register — the aggregating job is the "never a partial set" half', () => {
  test('FAILS when the aggregator does not need every other job', () => {
    const { code, out } = run(tree({ needs: ['linux', 'apple'] }));
    assert.equal(code, 1, out);
    assert.match(out, /does not `need` "windows"/);
  });

  test('FAILS when a NEW platform job is added and not wired into needs', () => {
    // The mutation that matters in practice: nobody deletes a `needs` entry,
    // they add a job and forget one line. Modelled by naming a fourth job.
    const { code, out } = run(tree({ needs: ['linux', 'windows'] }));
    assert.equal(code, 1, out);
    assert.match(out, /does not `need` "apple"/);
  });

  test('FAILS when the aggregator needs a job the workflow does not declare', () => {
    const { code, out } = run(tree({ needs: ['linux', 'windows', 'apple', 'freebsd'] }));
    assert.equal(code, 1, out);
    assert.match(out, /which the workflow does not declare/);
  });

  test('FAILS when the aggregator stops testing for cancelled', () => {
    const { code, out } = run(tree({ verdicts: ['failure', 'skipped'] }));
    assert.equal(code, 1, out);
    assert.match(out, /never evaluates contains\(needs\.\*\.result, 'cancelled'\)/);
  });

  // ── review 2026-07-31 hardening: structural verdicts, exit 1, inline comments ──
  test('FAILS when the aggregator merely ECHOES the verdict words (structural, not substring)', () => {
    const { code, out } = run(tree({ verdictStyle: 'echo' }));
    assert.equal(code, 1, out);
    assert.match(out, /never evaluates contains/);
  });

  test('FAILS when the aggregator never exits 1', () => {
    const { code, out } = run(tree({ exitOne: false }));
    assert.equal(code, 1, out);
    assert.match(out, /never `exit 1`s/);
  });

  test('FAILS when an inline-commented job escapes the needs check', () => {
    const extra = ['  wasm:   # experimental wasm lane', '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo hi'].join('\n');
    const { code, out } = run(tree({ extraJob: extra }));
    assert.equal(code, 1, out);
    assert.match(out, /does not `need` "wasm"/);
  });

  test('FAILS when the register names an aggregating job that does not exist', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.aggregatingJob.job = 'nope'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /none of them is "nope"/);
  });

  test('FAILS when the register declares no aggregating job at all', () => {
    const { code, out } = run(tree({ mutate: (r) => { delete r.aggregatingJob; } }));
    assert.equal(code, 1, out);
    assert.match(out, /no `aggregatingJob`/);
  });
});

describe('assert-channel-register — schema, stores and disqualified channels', () => {
  test('FAILS when a signing keyKind is outside the declared enum', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].signing.keyKind = 'probably-fine'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /signing\.keyKind is "probably-fine"/);
  });

  test('FAILS when a store channel has no store-metadata directory template', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].storeMetadataDir = null; } }));
    assert.equal(code, 1, out);
    assert.match(out, /no `storeMetadataDir` template/);
  });

  test('FAILS when a channel names a platform outside its surface\'s vocabulary', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].platforms = ['tizen']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /names platform "tizen", which is not one of/);
  });

  // ── the surface vocabulary, 2026-09-05 ────────────────────────────────────
  // The platform names moved OUT of this guard and into the register when the
  // extension surface landed, so the three properties that used to be implicit
  // in a literal `Set` are asserted here instead: the block is required, a row
  // must name a surface it declares, and a name legal on one surface is illegal
  // on another. The last is the one that matters — without it `surface` would be
  // a label rather than a domain.
  test('FAILS COVERAGE LOST when the register declares no surfaces block', () => {
    const { code, out } = run(tree({ mutate: (r) => { delete r.surfaces; } }));
    assert.equal(code, 2, out);
    assert.match(out, /declares no `surfaces` vocabulary/);
  });

  test('FAILS COVERAGE LOST when the surfaces block is emptied', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.surfaces = {}; } }));
    assert.equal(code, 2, out);
    assert.match(out, /ZERO surfaces in it/);
  });

  test('FAILS when a row declares a surface the register does not', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].surface = 'gadget'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /has surface "gadget"; expected one of/);
  });

  test('FAILS when a row carries NO surface at all — absent is not a default', () => {
    const { code, out } = run(tree({ mutate: (r) => { delete r.channels[1].surface; } }));
    assert.equal(code, 1, out);
    assert.match(out, /has surface null; expected one of/);
  });

  test("FAILS when a row claims a platform legal on ANOTHER surface but not its own", () => {
    const { code, out } = run(tree({
      mutate: (r) => {
        r.surfaces.extension = {
          what: 'a browser extension',
          flutterApp: false,
          platforms: ['chrome', 'edge', 'firefox'],
          platformsSource: 'the browser names',
          storeMetadataGradedBy: 'tooling/ci/assert-store-metadata.mjs',
        };
        r.channels[1].platforms = ['chrome'];   // still surface "app"
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /is surface "app" and names platform "chrome"/);
  });

  test('FAILS when a surface names a storeMetadataGradedBy that does not exist', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.surfaces.app.storeMetadataGradedBy = 'tooling/ci/assert-nothing.mjs'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /which does not exist. A surface pointing at a deleted grader/);
  });

  // ⏱ 2026-09-15 — O-EXT-SURFACE-AXIS. `flutterApp` is the declaration six guards
  // scope by (tooling/ci/channel-surface.mjs); a surface without it is refused here.
  test('FAILS when a surface declares no boolean `flutterApp` — six guards would have to guess', () => {
    const { code, out } = run(tree({ mutate: (r) => { delete r.surfaces.app.flutterApp; } }));
    assert.equal(code, 1, out);
    assert.match(out, /surfaces\."app" declares no boolean `flutterApp`/);
  });

  test('FAILS when `flutterApp` is not a boolean — "yes" is not a declaration', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.surfaces.app.flutterApp = 'yes'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /surfaces\."app" declares no boolean `flutterApp`/);
  });

  test('a THIRD surface declared without `flutterApp` is refused, and its store row gets NEITHER clause set', () => {
    const { code, out } = run(tree({
      mutate: (r) => {
        r.surfaces.script = {
          what: 'a hypothetical third surface',
          platforms: ['node'],
          platformsSource: 'this test',
          storeMetadataGradedBy: 'tooling/ci/assert-store-metadata.mjs',
        };
        r.channels.push({ ...structuredClone(r.channels[1]), id: 'cli-store', surface: 'script', platforms: ['node'] });
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /surfaces\."script" declares no boolean `flutterApp`/);
    assert.doesNotMatch(out, /cli-store[^\n]*storeMetadataDir/, 'an undecided row must not be graded with the APP clauses');
  });

  test('FAILS when a surface declares an EMPTY platform vocabulary — it would accept every typo', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.surfaces.app.platforms = []; } }));
    assert.equal(code, 2, out);
    assert.match(out, /declares no non-empty `platforms` array/);
  });

  test('FAILS when two surfaces claim one platform name — section 3b resolves an emit by platform', () => {
    const { code, out } = run(tree({
      mutate: (r) => {
        r.surfaces.extension = {
          what: 'a browser extension',
          flutterApp: false,
          platforms: ['chrome', 'web'],
          platformsSource: 'the browser names',
          storeMetadataGradedBy: 'tooling/ci/assert-store-metadata.mjs',
        };
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /are claimed by more than one surface/);
  });

  test('FAILS when two channels share an id', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].id = 'web'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /duplicate id/);
  });

  // ── the ADR check is MODE-AWARE, and both modes are tested ────────────────
  // Found the hard way: this guard's first CI run failed on run 30609219162
  // because `Private/` is gitignored, so a correct check reported a fault that
  // did not exist. The fix must not lose the case below, which is the one that
  // matters — harness present, ADR gone.
  test('FAILS when the harness IS checked out and the cited ADR is not on disk', () => {
    const { code, out } = run(tree({ adrOnDisk: false }));
    assert.equal(code, 1, out);
    assert.match(out, /which is not on disk although `Private\/` is/);
  });

  test('FAILS when the harness IS checked out and the ADR is not LOCKED', () => {
    const { code, out } = run(tree({ adrLocked: false }));
    assert.equal(code, 1, out);
    assert.match(out, /does not record itself as LOCKED/);
  });

  test('PRINTS the limit rather than failing when the whole harness is absent (CI)', () => {
    const { code, out } = run(tree({ harnessPresent: false }));
    assert.equal(code, 0, out);
    assert.match(out, /ADR UNVERIFIABLE IN THIS CHECKOUT/);
    assert.match(out, /This is a stated limit, not a pass/);
  });

  test('still FAILS a malformed ADR citation even with no harness — every mode', () => {
    const { code, out } = run(tree({ harnessPresent: false, mutate: (r) => { r.disqualified[0].adr = ''; } }));
    assert.equal(code, 1, out);
    assert.match(out, /cites no ADR path/);
  });

  test('FAILS when a channel is both live and disqualified', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].id = 'flathub'; r.channels[1].platforms = ['linux']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /both a live channel and a disqualified one/);
  });

  test('PRINTS every disqualified channel on a passing run', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /DISQUALIFIED: flathub/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Review 2026-07-31, medium/low triage. Each case below is a mutation that was
// run against the REAL tree first and exited 0 "ok" before these fixes landed —
// the fixtures pin what the tree-level proof established, in that order.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — the key vocabulary is the REGISTER\'s', () => {
  test('FAILS COVERAGE LOST when the register declares no keyKinds', () => {
    const { code, out } = run(tree({ mutate: (r) => { delete r.keyKinds; } }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no `keyKinds` vocabulary/);
  });

  test('FAILS COVERAGE LOST when the keyKinds dictionary is emptied', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.keyKinds = {}; } }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
  });

  // The drift direction, which deletion alone does not cover: the dictionary is
  // renamed while rows keep the old name, so rows validate against a vocabulary
  // the register no longer documents.
  test('FAILS when a row uses a keyKind the register no longer defines', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => {
          r.keyKinds['self-managed-key'] = r.keyKinds['app-signing-key'];
          delete r.keyKinds['app-signing-key'];
          r.channels[1].signing.keyKind = 'app-signing-key';
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /signing\.keyKind is "app-signing-key"/);
    assert.match(out, /self-managed-key/); // the enum printed is the register's
  });

  test('FAILS when a keyKind definition is emptied — the loss consequence IS the field', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.keyKinds['upload-key'] = ''; } }));
    assert.equal(code, 1, out);
    assert.match(out, /keyKinds\."upload-key" has no definition text/);
  });
});

describe('assert-channel-register — array ELEMENTS, not just arrays', () => {
  test('FAILS when artifactFormats carries a non-string element', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[0].artifactFormats = [null]; } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares artifactFormat null, which is not a non-empty string/);
  });

  test('FAILS when artifactFormats carries an empty string', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].artifactFormats = ['']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares artifactFormat "", which is not a non-empty string/);
  });

  test('FAILS when minimumToolchain carries a non-string element', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[0].minimumToolchain = ['flutter', null]; } }));
    assert.equal(code, 1, out);
    assert.match(out, /names toolchain key null, which is not a non-empty string/);
  });
});

describe('assert-channel-register — the lane\'s output vs the formats its channel accepts', () => {
  test('FAILS when a SERVED row accepts nothing its lane emits', () => {
    // The lane builds web (a static bundle); the row says it accepts .apk.
    const { code, out } = run(tree({ mutate: (r) => { r.channels[0].artifactFormats = ['.apk']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /is SERVED and accepts "\.apk", but its lane/);
    assert.match(out, /emits "static-bundle"/);
  });

  test('PASSES when the served row accepts what its lane actually builds', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /is SERVED and accepts/);
  });

  // The .aab-vs-.apk shape: deferred, so it PRINTS. Failing here would block all
  // CI on owner-gated store work ([pipeline C-6]); silence would make it permanent.
  test('PRINTS rather than fails when a DEFERRED row\'s platform is built in another format', () => {
    const { code, out } = run(tree({ windowsRun: 'flutter build windows --release --dart-define=RELEASE_CHANNEL=windows-store' }));
    assert.equal(code, 0, out);
    assert.match(out, /FORMAT GAP \(deferred\): channel "windows-store" accepts "\.msix"/);
    assert.match(out, /builds "\.exe" for "windows"/);
  });

  test('does NOT print a format gap for a deferred row nothing builds yet', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /FORMAT GAP/);
  });

  // 🔴 THE CLOSING HALF OF THE .aab GAP, and the reason it is a separate test:
  // "no FORMAT GAP printed" is also what a comparison that STOPPED READING looks
  // like. This asserts the gap goes away because `flutter build appbundle` is
  // there, on the same fixture that prints one without it — so the silence is
  // attributable. [10]D-10 / build-platforms.yml's android lane.
  test('a DEFERRED row prints NO format gap once its lane emits the accepted format', () => {
    const withGap = run(
      tree({
        windowsRun: 'flutter build apk --release --dart-define=RELEASE_CHANNEL=windows-store',
        mutate: (r) => { r.channels[1].platforms = ['android']; r.channels[1].artifactFormats = ['.aab']; },
      }),
    );
    assert.equal(withGap.code, 0, withGap.out);
    assert.match(withGap.out, /FORMAT GAP \(deferred\)[\s\S]*builds "\.apk" for "android"/);

    const closed = run(
      tree({
        windowsRun:
          'flutter build apk --release --dart-define=RELEASE_CHANNEL=windows-store\n' +
          '      - run: flutter build appbundle --release --dart-define=RELEASE_CHANNEL=windows-store',
        mutate: (r) => { r.channels[1].platforms = ['android']; r.channels[1].artifactFormats = ['.aab']; },
      }),
    );
    assert.equal(closed.code, 0, closed.out);
    assert.doesNotMatch(closed.out, /FORMAT GAP/, closed.out);
  });

  // ── [10]D-10 limb (i): the submission block must RESOLVE ──────────────────
  // 🔴 THIS WHOLE GROUP EXISTS BECAUSE THE LIMB WAS PROSE. Until 2026-08-01 both
  // `submission` blocks in the real register documented, in their own `_why`,
  // that the path was "parsed rather than grepped" — and no line of any guard
  // read the field. A requirement that describes its own enforcement and is not
  // enforced is exactly what D-10's replacement acceptance was written to remove.
  test('PASSES when a submission block resolves script → workflow → job that runs it', () => {
    const { code, out } = run(tree({ withSubmission: true }));
    assert.equal(code, 0, out);
    assert.match(out, /1 submission path\(s\) resolve to a workflow job that runs the named script/);
  });

  test('FAILS when the submission script is not on disk', () => {
    const { code, out } = run(tree({ withSubmission: true, submissionScriptOnDisk: false }));
    assert.equal(code, 1, out);
    assert.match(out, /names submission script "tooling\/release\/submit-thing\.mjs", which does not exist/);
  });

  test('FAILS when the submission workflow does not exist', () => {
    const { code, out } = run(tree({ withSubmission: true, submissionWorkflowOnDisk: false }));
    assert.equal(code, 1, out);
    assert.match(out, /names submission workflow .*submit-thing\.yml, which does not exist/);
  });

  test('FAILS when the submission names a job the workflow does not declare', () => {
    const { code, out } = run(tree({ withSubmission: true, mutate: (r) => { r.channels[1].submission.job = 'ghost'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /claims submission job "ghost"/);
  });

  // 🔴 THE CASE THAT MAKES THE OTHER THREE MEAN SOMETHING. A real script and a
  // real job that have nothing to do with each other pass every existence check
  // and are not a wired submission path.
  test('FAILS when the named job exists but never invokes the named script', () => {
    const { code, out } = run(tree({ withSubmission: true, jobRunsScript: false }));
    assert.equal(code, 1, out);
    assert.match(out, /that job never invokes that script/);
  });

  // ⏱ 2026-09-22 — a `working-directory` is part of the path. extensions.yml
  // runs `node scripts/publish-amo.mjs` under `defaults: run: working-directory:
  // extensions`; the register names `extensions/scripts/publish-amo.mjs`. The
  // relative spelling counts ONLY under a literal directory that is a leading
  // directory of the script, and only on a token boundary.
  const wdWorkflow = ({ workflowWd = null, jobWd = null, stepWd = null, call = 'node release/submit-thing.mjs --dry-run' } = {}) =>
    [
      'name: Submit',
      'on:',
      '  workflow_dispatch:',
      ...(workflowWd === null ? [] : ['defaults:', '  run:', `    working-directory: ${workflowWd}`]),
      'jobs:',
      '  gate:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: node tooling/ci/assert-gate-passed.mjs',
      '  dry-run:',
      '    runs-on: ubuntu-24.04',
      ...(jobWd === null ? [] : ['    defaults:', '      run:', `        working-directory: ${jobWd}`]),
      '    steps:',
      '      - name: Dry-run the submission',
      ...(stepWd === null ? [] : [`        working-directory: ${stepWd}`]),
      `        run: ${call}`,
      '',
    ].join('\n');
  const withWd = (opts) => tree({ withSubmission: true, extraFiles: { [SUBMIT_WORKFLOW]: wdWorkflow(opts) } });

  test('PASSES a relative call under the WORKFLOW-level working-directory that leads the script path', () => {
    const { code, out } = run(withWd({ workflowWd: 'tooling' }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /never invokes that script/);
  });

  test('PASSES a relative call under the JOB-level defaults working-directory', () => {
    const { code, out } = run(withWd({ jobWd: 'tooling' }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /never invokes that script/);
  });

  test('FAILS the same relative call when the STEP overrides the directory back to the root', () => {
    const { code, out } = run(withWd({ workflowWd: 'tooling', stepWd: '.' }));
    assert.equal(code, 1, out);
    assert.match(out, /that job never invokes that script/);
  });

  test('FAILS a relative call under a working-directory decided at run time', () => {
    const { code, out } = run(withWd({ workflowWd: '${{ inputs.dir }}' }));
    assert.equal(code, 1, out);
    assert.match(out, /that job never invokes that script/);
  });

  test('FAILS a path that only ENDS in the rest of the script name — a token boundary, not a suffix', () => {
    const { code, out } = run(withWd({ workflowWd: 'tooling', call: 'node myrelease/submit-thing.mjs --dry-run' }));
    assert.equal(code, 1, out);
    assert.match(out, /that job never invokes that script/);
  });

  test('FAILS when the submission block names no script at all', () => {
    const { code, out } = run(tree({ withSubmission: true, mutate: (r) => { delete r.channels[1].submission.script; } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares a `submission` with no `script`/);
  });

  test('FAILS when the submission block names no workflow/job', () => {
    const { code, out } = run(tree({ withSubmission: true, mutate: (r) => { delete r.channels[1].submission.workflow; } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares a `submission` with no \{workflow, job\}/);
  });

  // ── the asymmetry, one level up ───────────────────────────────────────────
  // BUILDING a submission path is owner-gated, so a submittable store row with
  // no block and no script PRINTS. KEEPING one is not owner-gated: abandon the
  // block and the script it left behind must FAIL, or it sits in the release
  // directory looking maintained and wired to nothing.
  test('PRINTS, and does not fail, for a submittable store row with no submission path at all', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /NO SUBMISSION PATH: channel "windows-store"/);
  });

  test('FAILS on a release script no row names — the abandoned-block case', () => {
    const { code, out } = run(tree({ withSubmission: true, mutate: (r) => { delete r.channels[1].submission; } }));
    assert.equal(code, 1, out);
    assert.match(out, /submit-thing\.mjs is a release script that NO channel row names/);
  });

  test('a declared script is NOT reported as an orphan', () => {
    const { out } = run(tree({ withSubmission: true }));
    assert.doesNotMatch(out, /is a release script that NO channel row names/);
  });

  // ── `submission.recipeScript` — the PACKAGING half ────────────────────────
  // A channel whose artifact has to be BUILT from a generated recipe before the
  // submission verb has anything to upload. It is admitted to the orphan check's
  // declared set, so it could have become a way to declare a release script into
  // silence: name the path, never call it, and the orphan check stops
  // complaining while nothing exercises the script. It is therefore held to a
  // STRONGER standard than `script` — a workflow must actually invoke it — and
  // these four cases are that standard's recorded failing input.
  test('PASSES and counts the packaging step when it is declared, on disk and invoked', () => {
    const { code, out } = run(tree({ withSubmission: true, withRecipeScript: true }));
    assert.equal(code, 0, out);
    assert.match(out, /1 packaging script\(s\) declared on a submission block and invoked by a workflow/);
  });

  test('FAILS when the packaging script is not on disk', () => {
    const { code, out } = run(tree({ withSubmission: true, withRecipeScript: true, recipeScriptOnDisk: false }));
    assert.equal(code, 1, out);
    assert.match(out, /names packaging script "tooling\/release\/generate-thing\.mjs", which does not exist/);
  });

  // 🔴 THE CASE THAT STOPS THIS FIELD BEING AN OPT-OUT. The script exists, it is
  // declared, and the orphan check is therefore satisfied — and nothing runs it.
  test('FAILS when the packaging script is declared and no workflow invokes it', () => {
    const { code, out } = run(tree({ withSubmission: true, withRecipeScript: true, recipeScriptInvoked: false }));
    assert.equal(code, 1, out);
    assert.match(out, /and no workflow in \.github\/workflows invokes it/);
    // ...and specifically NOT as an orphan: the declaration did its job and the
    // stronger check is what caught it. Two messages for one defect would leave
    // the reader guessing which limb is load-bearing.
    assert.doesNotMatch(out, /generate-thing\.mjs is a release script that NO channel row names/);
  });

  test('a COMMENTED-OUT invocation does not count — the workflow scan strips prose', () => {
    const { out } = run(tree({ withSubmission: true, withRecipeScript: true, recipeScriptInvoked: false }));
    assert.doesNotMatch(out, /1 packaging script\(s\) declared/);
  });

  test('reads the format gap from an upload-artifact path glob, not only the build verb', () => {
    const upload = [
      '      - uses: actions/upload-artifact@v4',
      '        with:',
      '          path: |',
      '            apps/subscriptiontracker/build/app/outputs/flutter-apk/*.apk',
    ].join('\n');
    const { code, out } = run(
      tree({
        windowsRun: `echo windows\n${upload}`,
        mutate: (r) => { r.channels[1].platforms = ['android']; r.channels[1].artifactFormats = ['.aab']; },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /FORMAT GAP \(deferred\): channel "windows-store" accepts "\.aab"/);
    assert.match(out, /builds "\.apk" for "android"/);
  });

  // The comparison's own coverage self-check: a lane it can no longer read makes
  // every format comparison range over an empty set and pass.
  test('FAILS COVERAGE LOST when no served lane yields a readable artifact', () => {
    const { code, out } = run(tree({ laneBuilds: false }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT ONE yielded a readable artifact/);
  });

  test('PRINTS an unmapped `flutter build` target rather than comparing against nothing', () => {
    // ⏱ 2026-09-22 — this limb still only PRINTS (the line asserted below), but
    // the run now exits 1: 6b-ii fails a stamped build whose target the census in
    // workflow-scan.mjs cannot place on a platform, because every census reader
    // (store-build-config, seams-wired) skips such a build and it would be graded
    // by nobody. The print is this limb's; the failure is 6b-ii's.
    const { code, out } = run(tree({ windowsRun: 'flutter build fuchsia --release --dart-define=RELEASE_CHANNEL=windows-store' }));
    assert.equal(code, 1, out);
    assert.match(out, /UNMAPPED BUILD TARGET\(S\): "fuchsia"/);
    assert.match(out, /FAIL [^\n]*\(job "windows", `flutter build fuchsia`\) builds target "fuchsia", which this census cannot map to a platform/);
  });
});

describe('assert-channel-register — [10]D-4\'s store/ownerQueue mapping, shape only', () => {
  test('FAILS when a store row carries no ownerQueue id', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].ownerQueue = null; } }));
    assert.equal(code, 1, out);
    assert.match(out, /is a store channel with no `ownerQueue` id/);
    assert.match(out, /\[10\]D-4/);
  });

  test('FAILS when a store row\'s ownerQueue is an empty string', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].ownerQueue = '   '; } }));
    assert.equal(code, 1, out);
    assert.match(out, /no `ownerQueue` id/);
  });

  test('does NOT require an ownerQueue on a non-store row', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[0].ownerQueue = null; } }));
    assert.equal(code, 0, out);
  });
});

describe('assert-channel-register — direction B is PER PLATFORM (pins PR #83)', () => {
  // The defect #83 closed: the check fired only when EVERY platform of a served
  // row was orphaned, so adding a second platform to the already-claimed web row
  // passed clean. The assertion that pins it is the NEGATIVE half — "web" must
  // NOT be named, or an all-or-nothing implementation could satisfy the match.
  test('FAILS naming ONLY the unclaimed platform when a claimed served row grows one', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[0].platforms = ['web', 'linux']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /channel "web" is SERVED and declares platform "linux", which no app/);
    assert.doesNotMatch(out, /declares platform "web", which no app/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [9]R-10 limb 3 — every RELEASE_CHANNEL stamped into an artifact resolves to a
// row. A free-text define has exactly ONE failure mode: a typo, which deploys
// perfectly and produces a binary reporting a channel nobody serves, for the
// life of that build. Mutation-proven against a copy of the real tree
// 2026-08-03: `=webb` ⇒ exit 1; removing the stamp ⇒ PRINTS, never fails.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — the RELEASE_CHANNEL stamp resolves to a row', () => {
  test('PASSES when the stamped channel is a declared row id', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /RELEASE_CHANNEL stamp\(s\) across .* each resolving to a register row/);
  });

  test('FAILS on a typo — the one failure mode a free-text define has', () => {
    const { code, out } = run(tree({ releaseChannel: 'webb' }));
    assert.equal(code, 1);
    assert.match(out, /RELEASE_CHANNEL=webb, and tooling\/channel-register\.json declares no channel with that id/);
    assert.match(out, /for the life of that build/);
  });

  test('FAILS when the stamp names a DISQUALIFIED channel', () => {
    const { code, out } = run(tree({ releaseChannel: 'flathub' }));
    assert.equal(code, 1);
    assert.match(out, /declares no channel with that id/);
  });

  test('a DEFERRED row id is a legal stamp — a build proof is still built for a channel', () => {
    // ⏱ 2026-09-22 — this case used to stamp `windows-store` onto the lane's WEB
    // build. That resolves (6b) but is a platform mismatch, which 6b-ii now fails
    // (the case below), so the deferred stamp is carried by a windows build.
    const { code, out } = run(tree({ windowsRun: 'flutter build windows --release --dart-define=RELEASE_CHANNEL=windows-store' }));
    assert.equal(code, 0, out);
  });

  test('FAILS a stamp that resolves to a row whose platforms exclude the build (6b-ii, census)', () => {
    // A web build stamped for the windows row: 6b is satisfied (the id exists),
    // and every census reader skips it as unplaceable — so it is graded by
    // nobody unless THIS limb fails it.
    const { code, out } = run(tree({ releaseChannel: 'windows-store' }));
    assert.equal(code, 1, out);
    assert.match(out, /deploy-web\.yml:\d+ \(job "deploy-web", `flutter build web`\) stamps RELEASE_CHANNEL=windows-store, whose `platforms` is \[windows\] and does not include "web"/);
    assert.match(out, /checked by nobody/);
  });

  test('no stamp anywhere, and no RELEASE build either, PRINTS the gap rather than failing', () => {
    // ⏱ CHANGED 2026-09-19 — this case used to build with no stamp and PRINT.
    // Since R10 the channel IS the rail, and a release build with no stamp is
    // limb 6b-ii's FAILURE (its own suite below). What still only prints is
    // 6b's attribution gap over a tree whose only build is --profile.
    const { code, out } = run(tree({ releaseChannel: null, laneBuilds: 'flutter build web --profile' }));
    assert.equal(code, 0, out);
    assert.match(out, /NO RELEASE_CHANNEL STAMP/);
    assert.match(out, /reports the compiled-in default/);
  });

  test('a COMMENT naming a RELEASE_CHANNEL value is not a stamp', () => {
    // laneWorkflow's header comment carries `RELEASE_CHANNEL=ghost-channel`,
    // which is not a declared row id. If comments were read, every case above
    // would already be red.
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /ghost-channel/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Limb 6b-ii (2026-09-19, R10) — every RELEASE `flutter build` passes a
// RELEASE_CHANNEL at all. The app asks ChassisBilling.railForDeclared with the
// compiled-in channel, and an undeclared one ('dev') sells nothing — right for a
// dev build, a silently switched-off paywall for a store artifact. The domain is
// derived through workflow-scan.mjs, so these cases drive its two block forms.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — every release build declares its channel (6b-ii)', () => {
  const CI = '.github/workflows/ci.yml';
  const ciWorkflow = (run) =>
    ['name: CI', 'on:', '  push:', 'jobs:', '  app-brick:', '    runs-on: ubuntu-24.04', '    steps:', `      - run: ${run}`, ''].join('\n');

  test('POSITIVE CONTROL — the stamped lane is counted, on a folded continuation line', () => {
    // laneWorkflow folds `flutter build web --release` and its define over two
    // lines of a `run: >` block; one logical command, so it IS stamped.
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /1 release `flutter build` command\(s\) across \d+ workflow\(s\): 1 declare RELEASE_CHANNEL, 0 declared exempt/);
  });

  test('FAILS a release build that passes no RELEASE_CHANNEL, naming the line and job', () => {
    const { code, out } = run(tree({ windowsRun: 'flutter build windows --release' }));
    assert.equal(code, 1, out);
    assert.match(out, /build-platforms\.yml:\d+ \(job "windows"\) builds "windows" and passes no --dart-define=RELEASE_CHANNEL/);
    assert.match(out, /paywall silently off/);
  });

  test('FAILS when the lane build loses its stamp — release is the DEFAULT mode, --release or not', () => {
    const { code, out } = run(tree({ releaseChannel: null }));
    assert.equal(code, 1, out);
    assert.match(out, /deploy-web\.yml:\d+ \(job "deploy-web"\) builds "web" and passes no --dart-define=RELEASE_CHANNEL/);
  });

  test('a stamp on the NEXT line of a `run: |` block is another command and does not count', () => {
    const { code, out } = run(
      tree({ windowsRun: '|\n          flutter build windows\n          echo --dart-define=RELEASE_CHANNEL=windows-store' }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /\(job "windows"\) builds "windows" and passes no --dart-define=RELEASE_CHANNEL/);
  });

  test('an explicit --debug / --profile build and a web-server are outside the domain', () => {
    for (const cmd of ['flutter build apk --debug', 'flutter build windows --profile', 'flutter build web-server']) {
      const { code, out } = run(tree({ windowsRun: cmd }));
      assert.equal(code, 0, `${cmd}\n${out}`);
    }
  });

  test('the DECLARED exemption holds for the probe stamp build, and is counted', () => {
    const { code, out } = run(tree({ extraFiles: { [CI]: ciWorkflow('flutter build web --pwa-strategy=none') } }));
    assert.equal(code, 0, out);
    // The count is what this fixture exempts; the list names every DECLARED key.
    assert.match(out, /1 declared exempt \([^)]*\.github\/workflows\/ci\.yml#app-brick[,)]/);
  });

  test('an exemption still HOLDS when its thrown-away build also stamps — the key excuses the output, not the stamp', () => {
    // ⏱ 2026-09-22 — this case used to be "a STALE exemption FAILS — the exempted
    // job stamps now". The exemptions moved from a `const` here to the register key
    // `releaseBuildsNeverShipped`, which assert-store-build-config reads too, and
    // there a stamped crash fixture would be graded for production keys unless it
    // stays excused. Stale now means "matches no release build at all" (below).
    const { code, out } = run(
      tree({ extraFiles: { [CI]: ciWorkflow('flutter build web --dart-define=RELEASE_CHANNEL=web') } }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /1 declared exempt \([^)]*\.github\/workflows\/ci\.yml#app-brick[,)]/);
  });

  test('a STALE exemption FAILS — the exempted job builds nothing', () => {
    const { code, out } = run(tree({ extraFiles: { [CI]: ciWorkflow('echo no build here') } }));
    assert.equal(code, 1, out);
    assert.match(out, /`releaseBuildsNeverShipped` declares \.github\/workflows\/ci\.yml job "app-brick" target "web"[^\n]*outlived its subject/);
  });

  test('a STALE exemption FAILS — the exempted job builds only ANOTHER target', () => {
    // The entry names target "web"; an apk in the same job is not what it excuses,
    // so the apk fails for its missing stamp AND the entry is stale.
    const { code, out } = run(tree({ extraFiles: { [CI]: ciWorkflow('flutter build apk') } }));
    assert.equal(code, 1, out);
    assert.match(out, /ci\.yml:\d+ \(job "app-brick"\) builds "apk" and passes no --dart-define=RELEASE_CHANNEL/);
    assert.match(out, /outlived its subject/);
  });

  test('the exemptions are the REGISTER\'s — delete the key and the probe build FAILS', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => { delete r.releaseBuildsNeverShipped; },
        extraFiles: { [CI]: ciWorkflow('flutter build web --pwa-strategy=none') },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /ci\.yml:\d+ \(job "app-brick"\) builds "web" and passes no --dart-define=RELEASE_CHANNEL/);
  });

  test('an exemption with no written why FAILS', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => { r.releaseBuildsNeverShipped.entries[0].why = 'short'; },
        extraFiles: { [CI]: ciWorkflow('flutter build web --pwa-strategy=none') },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /releaseBuildsNeverShipped \.github\/workflows\/ci\.yml#app-brick \(web\) carries no written `why`/);
  });

  test('a malformed exemption key is refused, never read as empty', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.releaseBuildsNeverShipped = ['not', 'the', 'shape']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /`releaseBuildsNeverShipped` is not `\{_why, entries: \[\.\.\.\]\}`/);
  });

  test('the exemption is scoped to its JOB — the same build in another job of ci.yml FAILS', () => {
    const body = ['name: CI', 'on:', '  push:', 'jobs:', '  other:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: flutter build web', ''].join('\n');
    const { code, out } = run(tree({ extraFiles: { [CI]: body } }));
    assert.equal(code, 1, out);
    assert.match(out, /ci\.yml:\d+ \(job "other"\) builds "web" and passes no/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Limb 6b-iii (2026-09-22, the mobile IAP opt-in) — a release build stamped with
// a STORE-rail channel compiles in exactly the RevenueCat key the register maps
// that rail to, and every other release build names the define nowhere. The rail
// is resolved from the STAMP, never from the artifact: the fixture's Play build
// is an `appbundle` in the `windows` job on purpose, so a guard keyed on the job
// or the target instead of the stamp cannot pass these cases.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — a store-rail build carries its store SDK key, nothing else does (6b-iii)', () => {
  const GOOGLE = 'REVENUECAT_PUBLIC_KEY_GOOGLE';
  const APPLE = 'REVENUECAT_PUBLIC_KEY_APPLE';
  const CI = '.github/workflows/ci.yml';
  const keyDefine = (secret) => '--dart-define=REVENUECAT_KEY=${{ secrets.' + secret + ' }}';
  const playBuild = (extra = '') =>
    `flutter build appbundle --release --dart-define=RELEASE_CHANNEL=android-play${extra ? ` ${extra}` : ''}`;
  const rail = (id) => ({ rail: id, why: 'fixture rail', forbids: [], forbidsWhy: 'fixture', source: 'fixture' });
  /** Rails on every row, plus the two key names declared non-signing so section
   *  8 has nothing to say — a red result here can only be 6b-iii. */
  const withRails =
    (extra = () => {}) =>
    (r) => {
      r.channels.find((c) => c.id === 'web').purchaseRail = rail('paddle');
      r.channels.find((c) => c.id === 'windows-store').purchaseRail = rail('paddle');
      r.channels.find((c) => c.id === ANDROID_ID).purchaseRail = rail('play-billing');
      r.ciSecretRegister = {
        kinds: { 'build-config': 'a value compiled into or read by a build; not signing material' },
        nonSigning: [GOOGLE, APPLE].map((name) => ({
          name,
          kind: 'build-config',
          why: 'a RevenueCat PUBLIC SDK key compiled into a store build; it signs nothing',
        })),
      };
      extra(r);
    };
  const storeTree = (opts = {}, extra) => tree({ withAndroid: true, mutate: withRails(extra), ...opts });
  const iapYaml = ['billing:', '  mobileIap:', '    provider: revenuecat', ''].join(NL);

  test('POSITIVE CONTROL — the Play build carries the mapped key, the web build carries none, one app opts in', () => {
    const { code, out } = run(
      storeTree({ windowsRun: playBuild(keyDefine(GOOGLE)), extraFiles: { 'apps/one/app.yaml': iapYaml } }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /6b-iii store SDK key — 1 store-rail release segment\(s\) pass --dart-define=REVENUECAT_KEY from the mapped secret \(play-billing: 1, apple-iap: 0\); 1 other release segment\(s\) name it nowhere; 1 app\(s\) declare billing\.mobileIap/);
  });

  test('(1) FAILS a play-billing-stamped build WITHOUT the define, naming file, job, line, channel, rail and the expected text', () => {
    const { code, out } = run(storeTree({ windowsRun: playBuild() }));
    assert.equal(code, 1, out);
    assert.match(
      out,
      // ⏱ 2026-09-23 (re-cut onto the census): the location is 6b-ii's `buildAt` —
      // `file:line (job "…", \`flutter build <target>\`)` — so both limbs name a build the same way.
      /build-platforms\.yml:\d+ \(job "windows", `flutter build appbundle`\) for channel "android-play" \(rail "play-billing"\) passes no REVENUECAT_KEY\. Expected: --dart-define=REVENUECAT_KEY=\$\{\{ secrets\.REVENUECAT_PUBLIC_KEY_GOOGLE \}\}/,
    );
  });

  test('(2) FAILS a paddle (web) build that carries the define', () => {
    const { code, out } = run(
      storeTree({ windowsRun: playBuild(keyDefine(GOOGLE)), laneBuilds: `flutter build web --release ${keyDefine(GOOGLE)}` }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /deploy-web\.yml:\d+ \(job "deploy-web", `flutter build web`\) is stamped "web", whose rail is "paddle"[^\n]*names REVENUECAT_KEY/);
    assert.match(out, /Expected: no REVENUECAT_KEY at all in this segment/);
  });

  test('(2b) FAILS a play-billing build compiled with the APPLE key', () => {
    const { code, out } = run(storeTree({ windowsRun: playBuild(keyDefine(APPLE)) }));
    assert.equal(code, 1, out);
    assert.match(
      out,
      /\(job "windows", `flutter build appbundle`\) for channel "android-play" \(rail "play-billing"\) names REVENUECAT_KEY 1 time\(s\) from secret\(s\) REVENUECAT_PUBLIC_KEY_APPLE\. Expected exactly: --dart-define=REVENUECAT_KEY=\$\{\{ secrets\.REVENUECAT_PUBLIC_KEY_GOOGLE \}\}/,
    );
  });

  test('FAILS a key on a build whose STAMP resolves to rail `none` — the artifact type decides nothing', () => {
    const { code, out } = run(
      storeTree(
        { windowsRun: `flutter build apk --release --dart-define=RELEASE_CHANNEL=windows-store ${keyDefine(GOOGLE)}` },
        (r) => { r.channels.find((c) => c.id === 'windows-store').purchaseRail = rail('none'); },
      ),
    );
    assert.equal(code, 1, out);
    assert.match(out, /`flutter build apk`\) is stamped "windows-store", whose rail is "none"[^\n]*names REVENUECAT_KEY/);
  });

  test('FAILS a key on a declared-EXEMPT (unstamped) build', () => {
    const ci = ['name: CI', 'on:', '  push:', 'jobs:', '  app-brick:', '    runs-on: ubuntu-24.04', '    steps:', `      - run: flutter build web ${keyDefine(GOOGLE)}`, ''].join(NL);
    const { code, out } = run(storeTree({ windowsRun: playBuild(keyDefine(GOOGLE)), extraFiles: { [CI]: ci } }));
    assert.equal(code, 1, out);
    assert.match(out, /ci\.yml:\d+ \(job "app-brick", `flutter build web`\) is a declared `releaseBuildsNeverShipped` build[^\n]*names REVENUECAT_KEY/);
  });

  test('(two-apps) FAILS while TWO app.yaml files declare billing.mobileIap and the map is keyed by rail', () => {
    const { code, out } = run(
      storeTree({
        windowsRun: playBuild(keyDefine(GOOGLE)),
        extraFiles: { 'apps/one/app.yaml': iapYaml, 'apps/two/app.yaml': iapYaml },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /2 apps declare `billing\.mobileIap` \(apps\/one\/app\.yaml, apps\/two\/app\.yaml\)/);
    assert.match(out, /key the secret names per app/);
  });

  test('FAILS when the define is not a RevenueCat surface in the capability register', () => {
    const { code, out } = run(storeTree({ windowsRun: playBuild(keyDefine(GOOGLE)), revenuecatSurfaces: ['SOMETHING_ELSE'] }));
    assert.equal(code, 1, out);
    assert.match(out, /`vendors\.revenuecat\.surfaces` does not list it/);
  });

  test('COVERAGE LOST (exit 2) when storeKeyDefine is missing, or keys a rail the dictionary does not declare', () => {
    const gone = run(storeTree({ windowsRun: playBuild(keyDefine(GOOGLE)) }, (r) => { delete r.purchaseRails.storeKeyDefine; }));
    assert.equal(gone.code, 2, gone.out);
    assert.match(gone.out, /FAIL COVERAGE LOST — tooling\/channel-register\.json `purchaseRails\.storeKeyDefine` is missing or malformed/);

    const typo = run(
      storeTree({ windowsRun: playBuild(keyDefine(GOOGLE)) }, (r) => {
        r.purchaseRails.storeKeyDefine.secretByRail = { 'play-biling': GOOGLE };
      }),
    );
    assert.equal(typo.code, 2, typo.out);
    assert.match(typo.out, /keys rail "play-biling", which `purchaseRails\.rails` does not declare/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [10]D-4's agent slice — the channel↔account status is IN THE TREE.
// `ownerQueue` points into nikatru/OWNER_QUEUE.md, which CI can never open
// (a separate private repo, not on the checkout), so before this field "does a publisher account exist for
// this channel?" had no answer a machine could give. The status cannot be
// derived — no API this repo can reach knows whether an enrolment completed —
// so it is owner-asserted and dated, and the GUARD holds it to a relationship.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — the channel↔account status', () => {
  // ⏱️ THESE FIXTURES ARE DATED RELATIVE TO NOW, NOT PINNED TO A LITERAL.
  // The guard prints the AGE of an accountStatus claim and says RE-ASSERT past a
  // 90-day horizon, so a fixture pinned to a literal date is a test that changes
  // its own answer on a day nobody chose — green today, red in a quarter, for a
  // reason unrelated to the code. `recent` is always fresh and `ancient` is
  // always stale, by construction.
  const isoDaysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const recent = isoDaysAgo(2);
  const ancient = isoDaysAgo(400);

  test('PASSES and PRINTS an unserved store row whose account does not exist', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    // The AGE is asserted as a shape, not a number: the base fixture is pinned to
    // a literal elsewhere, so its day-count legitimately grows with the calendar.
    assert.match(out, /ACCOUNT NONE: windows-store — OWNER_QUEUE A-2, asserted \d+d ago \(\d{4}-\d{2}-\d{2}\)/);
  });

  test('FAILS when a kind:store row carries no accountStatus at all', () => {
    const { code, out } = run(tree({ mutate: (r) => { delete r.channels[1].accountStatus; } }));
    assert.equal(code, 1);
    assert.match(out, /carries no `accountStatus`/);
    assert.match(out, /CI cannot open that file/);
  });

  // THE RELATIONSHIP. This is the limb that expires by itself.
  test("FAILS when a SERVED store row's account is not verified", () => {
    const { code, out } = run(
      tree({
        platforms: ['web', 'windows'],
        mutate: (r) => { r.channels[1].served = true; },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /is SERVED and its accountStatus is "none"/);
  });

  // The mirror image, and it is asserted on the MESSAGE rather than the exit
  // code on purpose: a row flipped to `served` in a fixture owes everything
  // else a served row owes (a lane, a submission block), so exit 0 would be
  // testing those instead. What this pins is that `verified` removes THIS
  // problem and stops printing THIS gap.
  test('a SERVED store row that IS verified draws neither the failure nor the print', () => {
    const { out } = run(
      tree({
        platforms: ['web', 'windows'],
        mutate: (r) => {
          r.channels[1].served = true;
          r.channels[1].accountStatus = { status: 'verified', asOf: recent, note: 'Partner Center, company account' };
        },
      }),
    );
    assert.doesNotMatch(out, /accountStatus is "verified"/);
    assert.doesNotMatch(out, /ACCOUNT VERIFIED/);
  });

  // ── THE STALENESS LIMB, NEGATIVE-TESTED BOTH WAYS ───────────────────────────
  // Why it exists: on 2026-08-05 the android-play row said "No Play Console
  // account" for two days after the account was verified, and the guard PRINTED
  // that false claim on every run — faithfully, in a message identical to the one
  // it had printed correctly for weeks. A gap-printer prints the gap; nothing in
  // it notices the gap CLOSED. And a `verified` row printed nothing at all, so
  // the status whose staleness is most expensive had no output.
  test('a VERIFIED row asserted long ago PRINTS RE-ASSERT — a verified enrolment can lapse', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => {
          r.channels[1].accountStatus = { status: 'verified', asOf: ancient, note: 'Partner Center, company account' };
        },
      }),
    );
    assert.equal(code, 0, out); // it PRINTS and never FAILS — re-confirming an enrolment is owner work
    assert.match(out, /ACCOUNT VERIFIED but ASSERTED \d+d AGO: windows-store/);
    assert.match(out, /RE-ASSERT/);
  });

  test('a NON-verified row asserted long ago says RE-ASSERT rather than repeating the status', () => {
    const { code, out } = run(
      tree({ mutate: (r) => { r.channels[1].accountStatus.asOf = ancient; } }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /ACCOUNT NONE: windows-store.*RE-ASSERT/);
  });

  test('FAILS on a free-text status — a status nobody can compare', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].accountStatus.status = 'in progress'; } }));
    assert.equal(code, 1);
    assert.match(out, /expected one of none, applied, verified/);
  });

  test('FAILS on an undated status — nobody can tell an undated claim has gone stale', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].accountStatus.asOf = ''; } }));
    assert.equal(code, 1);
    assert.match(out, /with no `asOf` date/);
  });

  test('PRINTS `applied` as a gap, and still passes', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].accountStatus.status = 'applied'; } }));
    assert.equal(code, 0, out);
    assert.match(out, /ACCOUNT APPLIED: windows-store/);
  });

  test('COVERAGE LOST when the register declares no store row at all', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].kind = 'direct'; r.channels[1].storeMetadataDir = null; } }));
    assert.equal(code, 2);
    assert.match(out, /no `kind: "store"` row/);
  });

  test('a non-store row is not asked for an accountStatus', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /channel "web".*accountStatus/);
  });

  // 🔴 `live` IS AN EXTENSION-SURFACE WORD, AND THIS IS THE CASE THAT PROVES IT.
  // The 2026-09-05 spelling of the `live` change put it in the served-channel gate
  // for every row; review measured `android-play` (Google Play — a store that DOES
  // verify) passing SILENTLY with `served: true` + `live`, where main refused the
  // same row outright. These three cases are the green control, the app-surface
  // refusal, and the served bypass that was measured.
  test('the extension-surface row may claim `live` — the green control for the two cases below', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /claims accountStatus.status "live"/);
  });

  test('FAILS when an APP-surface store row claims `live` — a store that verifies has "verified" to earn', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].accountStatus.status = 'live'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /channel "windows-store" is on the "app" surface and claims accountStatus.status "live"/);
  });

  test('FAILS on the measured bypass — a SERVED app-surface row does not get its account from `live`', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => {
          r.channels[1].served = true;
          r.channels[1].accountStatus = { status: 'live', asOf: '2026-08-12', note: 'account open' };
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /channel "windows-store" is on the "app" surface and claims accountStatus.status "live"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6c-ii, 2026-09-24 — O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN limb 3. Box A's
// captcha refuses every auth call a native build makes, so a native row may not
// be SERVED until its build can sign somebody in. A served fixture row owes
// everything else a served row owes (a lane, a verified account), so the refusal
// cases pin the MESSAGE, and the exit pins that the guard did not pass.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — §6c-ii: a served native row is one whose build can sign in', () => {
  const serveAndroid = (nativeAuth) => (r) => {
    const a = r.channels.find((c) => c.id === ANDROID_ID);
    a.served = true;
    a.nativeAuth = nativeAuth;
  };

  test('a native row with served:true and nativeAuth:false exits 1', () => {
    const { code, out } = run(tree({ withAndroid: true, mutate: serveAndroid(false) }));
    assert.equal(code, 1, out);
    assert.match(out, /channel "android-play" is SERVED with nativeAuth: false/);
    assert.match(out, /\(O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN\)/);
  });

  test('a native row without nativeAuth exits 1', () => {
    const { code, out } = run(tree({ mutate: (r) => { delete r.channels.find((c) => c.id === 'windows-store').nativeAuth; } }));
    assert.equal(code, 1, out);
    assert.match(out, /channel "windows-store" is a native row and carries no boolean `nativeAuth` \(found null\)/);
  });

  test('a web row carrying nativeAuth exits 1', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels.find((c) => c.id === 'web').nativeAuth = true; } }));
    assert.equal(code, 1, out);
    assert.match(out, /channel "web" carries `nativeAuth`, and it is not a native row \(surface "app", kind "web"\)/);
  });

  test('an extension row carrying nativeAuth exits 1', () => {
    const { code, out } = run(tree({ withExtension: true, mutate: (r) => { r.channels.find((c) => c.id === 'chrome-webstore').nativeAuth = false; } }));
    assert.equal(code, 1, out);
    assert.match(out, /channel "chrome-webstore" carries `nativeAuth`, and it is not a native row \(surface "extension", kind "store"\)/);
  });

  test('a native row with served:true and nativeAuth:true passes this limb', () => {
    const { out } = run(tree({ withAndroid: true, mutate: serveAndroid(true) }));
    assert.doesNotMatch(out, /is SERVED with nativeAuth/);
    assert.match(out, /ok\s+nativeAuth — 2 native row\(s\), 1 able to sign in, 1 served/);
  });

  test('the summary names the native count', () => {
    const { code, out } = run(tree({ withAndroid: true }));
    assert.equal(code, 0, out);
    assert.match(out, /ok\s+nativeAuth — 2 native row\(s\), 0 able to sign in, 0 served \[O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN\]/);
  });

  test('a register with no native row is COVERAGE LOST, never a pass over nothing', () => {
    const { code, out } = run(tree({ withExtension: true, mutate: (r) => { r.channels = r.channels.filter((c) => c.id !== 'windows-store'); } }));
    assert.equal(code, 2, out);
    assert.match(out, /declares no native row/);
  });

  // The `&& undeclared === 0` half of the COVERAGE LOST condition: with no native row
  // because the only one sits on an undeclared surface, the empty domain is that row's
  // finding, and exit 2 would mask it.
  test('no native row because the only one sits on an undeclared surface exits 1 on that surface, not COVERAGE LOST', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => {
          r.channels = r.channels.filter((c) => c.kind === 'web' || c.id === 'windows-store');
          r.channels.find((c) => c.id === 'windows-store').surface = 'gadget';
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /has surface "gadget"; expected one of/);
    assert.doesNotMatch(out, /declares no native row/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ADR limb, extended to `nonChannelSigningIdentities` 2026-08-03 — the
// MECHANICAL half of the stage-9 doc-rot sweep. The pack-key entry cited
// [ADR 022] three times IN PROSE and named no path, so nothing could tell
// whether the decision its custody model rests on still says what it claims.
// Same MODE-AWARE shape as `disqualified`: the harness ROOT decides, and a CI
// checkout PRINTS its limit rather than passing over it.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — a signing identity cites an openable, LOCKED decision', () => {
  const withIdentity = (over = {}) => (r) => {
    r.nonChannelSigningIdentities = [
      {
        id: 'content-pack-k1',
        keyKind: 'app-signing-key',
        adr: 'Private/decisions/022-pack-signing-key-custody.md',
        restoreDrill: { date: null, required: true, note: 'never drilled' },
        ...over,
      },
    ];
  };
  const withAdrFile = (root, locked = true) => ({
    'Private/decisions/022-pack-signing-key-custody.md': locked ? '# 022\n**Status:** LOCKED 2026-07-27\n' : '# 022\n**Status:** proposed\n',
  });

  test('PASSES and PRINTS the undrilled key when the ADR is LOCKED and on disk', () => {
    const { code, out } = run(tree({ mutate: withIdentity(), extraFiles: withAdrFile() }));
    assert.equal(code, 0, out);
    assert.match(out, /UNDRILLED IDENTITY: content-pack-k1/);
    assert.doesNotMatch(out, /IDENTITY ADR UNVERIFIABLE/);
  });

  test('FAILS when a signing identity cites no ADR path at all — prose is not a citation', () => {
    const { code, out } = run(tree({ mutate: withIdentity({ adr: undefined }) }));
    assert.equal(code, 1);
    assert.match(out, /cites no `adr` path/);
    assert.match(out, /nobody can open/);
  });

  test('FAILS when the cited ADR is not on disk although the harness IS', () => {
    const { code, out } = run(tree({ mutate: withIdentity() }));
    assert.equal(code, 1);
    assert.match(out, /which is not on disk although `Private\/` is/);
  });

  test('FAILS when the cited ADR does not record itself LOCKED', () => {
    const { code, out } = run(tree({ mutate: withIdentity(), extraFiles: withAdrFile(null, false) }));
    assert.equal(code, 1);
    assert.match(out, /does not record itself as LOCKED/);
    assert.match(out, /can change under the key/);
  });

  test('PRINTS the stated limit in a checkout with no harness, and does not fail', () => {
    const { code, out } = run(tree({ mutate: withIdentity(), harnessPresent: false }));
    assert.equal(code, 0, out);
    assert.match(out, /IDENTITY ADR UNVERIFIABLE IN THIS CHECKOUT: content-pack-k1/);
    assert.match(out, /A stated limit, not a pass/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [9]R-3 LIMB 2 — "a lane that names a secret not in the register must FAIL".
//
// ⚠️ THESE ARE THE SECOND LINE OF EVIDENCE. The first is the mutation run against
// the REAL tree, recorded in the guard's header: a bogus `secrets.NOT_IN_REGISTER`
// added to .github/workflows/build-platforms.yml, confirmed RED, and the file
// restored byte-for-byte. A fixture encodes the same misunderstanding as the
// guard that wrote it, and this repo has a recorded case of six fixture tests
// passing against a guard whose real-tree behaviour was broken.
describe('assert-channel-register — [9]R-3 limb 2: only declared secrets may be named', () => {
  /** The declared NOT-signing half of the partition, in fixture form. */
  const secretRegister = (nonSigning) => ({
    kinds: {
      'build-config': 'a value compiled into or read by a build; not signing material',
      'publishing-credential': 'authorises an upload; is not what signs the artifact',
    },
    nonSigning,
  });
  const buildConfig = (name, why = 'an endpoint the build is compiled against, not signing material') => ({
    name,
    kind: 'build-config',
    why,
  });
  /** A served row holding a real key, plus the lane that names its secret — the
   *  minimum shape in which limb 2 has anything at all to range over. */
  const signingRow =
    (names = ['FIXTURE_UPLOAD_KEY']) =>
    (r) => {
      const c = r.channels.find((x) => x.id === 'web');
      c.signing.keyKind = 'upload-key';
      c.signing.identity = 'release-keystore/upload.keystore';
      // A dated drill, so the only thing these cases can fail on is limb 2. An
      // unrelated FAIL riding along makes a green/red result unattributable.
      c.signing.restoreDrill = { date: '2026-07-31', required: true, note: 'drilled' };
      // §8b: a written reason per declared name, derived from `names` so that a
      // case exercising limb 2 never fails on the reason limb by accident. The
      // reason limb has its own cases below, where the `why` is removed on purpose.
      c.signing.ciSecrets = {
        names,
        why: Object.fromEntries(names.map((n) => [n, `${n} carries the fixture signing identity into CI`])),
      };
    };

  test('FAILS when a lane names a secret the register does not declare', () => {
    const { code, out } = run(tree({ laneSecrets: ['NOT_IN_REGISTER'] }));
    assert.equal(code, 1, out);
    assert.match(out, /name\(s\) `secrets\.NOT_IN_REGISTER`, which the register does not declare/);
    assert.match(out, /\[9\]R-3/);
  });

  test('PASSES once that same secret is declared as non-signing, with a reason', () => {
    const { code, out } = run(
      tree({
        laneSecrets: ['NOT_IN_REGISTER'],
        mutate: (r) => {
          r.ciSecretRegister = secretRegister([buildConfig('NOT_IN_REGISTER')]);
        },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /1 secret\(s\) named across .* all declared/);
  });

  test('FAILS a non-signing entry whose kind the register does not declare', () => {
    const { code, out } = run(
      tree({
        laneSecrets: ['NOT_IN_REGISTER'],
        mutate: (r) => {
          r.ciSecretRegister = secretRegister([{ ...buildConfig('NOT_IN_REGISTER'), kind: 'vibes' }]);
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /has kind "vibes", which `ciSecretRegister\.kinds` does not declare/);
  });

  // The classification has to cost something, or the cheapest way to silence a
  // limb-2 failure is to paste the name into the allowlist.
  test('FAILS a non-signing entry with no `why` — a bare name is not a classification', () => {
    const { code, out } = run(
      tree({
        laneSecrets: ['NOT_IN_REGISTER'],
        mutate: (r) => {
          r.ciSecretRegister = secretRegister([{ name: 'NOT_IN_REGISTER', kind: 'build-config' }]);
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /carries no `why`/);
    assert.match(out, /turns a classification decision into a copy-paste/);
  });

  test('FAILS when one name is declared BOTH signing and non-signing', () => {
    const { code, out } = run(
      tree({
        laneSecrets: ['FIXTURE_UPLOAD_KEY'],
        mutate: (r) => {
          signingRow()(r);
          r.ciSecretRegister = secretRegister([buildConfig('FIXTURE_UPLOAD_KEY')]);
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /is declared BOTH as signing material/);
  });

  // ── the row-level rule that keeps the coverage floor below REACHABLE ───────
  // Without it, the way to satisfy "at least one declared signing secret is
  // named by a lane" is to declare none — an empty domain passing for the wrong
  // reason, one level up from the check it protects.
  test('FAILS a row that holds a real key and has a lane but declares no ciSecrets', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => {
          const c = r.channels.find((x) => x.id === 'web');
          c.signing.keyKind = 'upload-key';
          c.signing.identity = 'release-keystore/upload.keystore';
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /declares no `signing\.ciSecrets\.names`/);
    assert.match(out, /an empty authority accepts every name/);
  });

  test('FAILS a keyKind "none" row that declares ciSecrets anyway', () => {
    const { code, out } = run(
      tree({
        laneSecrets: ['FIXTURE_UPLOAD_KEY'],
        mutate: (r) => {
          r.channels.find((x) => x.id === 'web').signing.ciSecrets = { names: ['FIXTURE_UPLOAD_KEY'] };
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /cannot both hold no key and need secrets to use one/);
  });

  // ── REQUIRED_COVERAGE: the empty-domain cases ─────────────────────────────
  test('COVERAGE LOST when secrets are declared as signing and NO lane names any of them', () => {
    const { code, out } = run(tree({ mutate: signingRow() }));
    assert.equal(code, 2, out);
    assert.match(out, /FAIL COVERAGE LOST/);
    assert.match(out, /disjoint sets of names/);
    assert.match(out, /the scan found no/);
  });

  test('COVERAGE LOST when a register-named lane sits outside the scanned directory', () => {
    const OUTSIDE = '.github/lanes/deploy-web.yml';
    const body = [
      'name: x',
      'on:',
      '  push:',
      'jobs:',
      '  deploy-web:',
      '    steps:',
      '      - run: flutter build web --release --dart-define=RELEASE_CHANNEL=web',
      '',
    ].join('\n');
    const { code, out } = run(
      tree({
        extraFiles: { [OUTSIDE]: body },
        mutate: (r) => {
          r.channels.find((x) => x.id === 'web').lane.workflow = OUTSIDE;
        },
      }),
    );
    assert.equal(code, 2, out);
    assert.match(out, /FAIL COVERAGE LOST/);
    assert.match(out, /is NOT in the \.github\/workflows scan/);
  });

  // ── the converse: a ceiling, not a floor. See the guard header for why. ────
  test('PRINTS, and does not fail, a declared signing secret no lane names', () => {
    const { code, out } = run(
      tree({
        laneSecrets: ['FIXTURE_UPLOAD_KEY'],
        mutate: signingRow(['FIXTURE_UPLOAD_KEY', 'FIXTURE_UNUSED_KEY']),
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /SIGNING SECRET DECLARED, NO LANE NAMES IT: FIXTURE_UNUSED_KEY/);
    assert.doesNotMatch(out, /SIGNING SECRET DECLARED, NO LANE NAMES IT: FIXTURE_UPLOAD_KEY/);
  });

  test('PRINTS a non-signing declaration no workflow references', () => {
    const { code, out } = run(
      tree({
        laneSecrets: ['NOT_IN_REGISTER'],
        mutate: (r) => {
          r.ciSecretRegister = secretRegister([buildConfig('NOT_IN_REGISTER'), buildConfig('STALE_LEFTOVER')]);
        },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /DECLARED SECRET NO WORKFLOW NAMES: STALE_LEFTOVER/);
  });

  // ── the two decoys a text grep falls for, both real ───────────────────────
  test('does not read a secret out of a COMMENT', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /GHOST_SECRET/);
  });

  test('does not read `secrets.mjs` out of the filename scan-secrets.mjs', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /secrets\.mjs`, which the register does not declare/);
  });

  test('FAILS a secret named by EXPRESSION — one indirection would make limb 2 vacuous', () => {
    const DYN = '.github/workflows/dyn.yml';
    const body = [
      'name: d',
      'on:',
      '  push:',
      'jobs:',
      '  j:',
      '    steps:',
      '      - run: echo "${{ secrets[format(\'A_{0}\', 1)] }}"',
      '',
    ].join('\n');
    const { code, out } = run(tree({ extraFiles: { [DYN]: body } }));
    assert.equal(code, 1, out);
    assert.match(out, /names a secret by EXPRESSION/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — [9]R-3: the register's signing declaration vs the REAL Gradle
// build. Section 8 compares the register to the WORKFLOWS and its own header
// recorded what that left open: "a rename in Gradle alone is still silent".
//
// ⚠️ SECOND LINE OF EVIDENCE, AS EVER. The first is 10 mutations of the REAL
// tree, each restored and SHA-256-verified byte-identical: renaming a value in
// apps/subscriptiontracker/android/app/build.gradle.kts, renaming one in
// tooling/channel-register.json, deleting a real assignment from the signing
// config, unwiring the release build type, commenting the map out, going stale
// on `transport.substitutes`, deleting `gradleContract`, pointing `declaredIn`
// at a moved file, dropping `.kts` from the SHARED comment reduction, and
// deleting the android row entirely. All ten red. A fixture encodes the same
// misunderstanding as the guard that wrote it; these keep the ten closed.
describe('assert-channel-register — [9]R-3: the register agrees with the real build.gradle.kts', () => {
  const contract = (r) => r.channels.find((c) => c.id === ANDROID_ID).signing.ciSecrets.gradleContract;
  const secrets = (r) => r.channels.find((c) => c.id === ANDROID_ID).signing.ciSecrets;

  test('PASSES when the register and the build file name the same four values', () => {
    const { code, out } = run(tree({ withAndroid: true }));
    assert.equal(code, 0, out);
    assert.match(out, /1 Android build file\(s\) cross-checked against the register — 4 signing value name\(s\) agree/);
  });

  // ── direction 1: the build moves ──────────────────────────────────────────
  test('FAILS when the BUILD FILE renames a value and the register does not', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        gradle: {
          pairs: [
            ['storeFile', 'ANDROID_KEYSTORE_PATH'],
            ['storePassword', 'ANDROID_KEYSTORE_PASSWORD'],
            ['keyAlias', 'ANDROID_KEY_ALIAS_V2'],
            ['keyPassword', 'ANDROID_KEY_PASSWORD'],
          ],
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /carries the signing identity in ANDROID_KEY_ALIAS_V2 \(Gradle's "keyAlias"\)/);
    assert.match(out, /declares "ANDROID_KEY_ALIAS" in `signing\.ciSecrets\.names` and .* never reads it/);
  });

  // ── direction 2: the register moves ───────────────────────────────────────
  test('FAILS when the REGISTER renames a value and the build file does not', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        mutate: (r) => {
          secrets(r).names = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD_V2'];
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /carries the signing identity in ANDROID_KEY_PASSWORD \(Gradle's "keyPassword"\)/);
    assert.match(out, /declares "ANDROID_KEY_PASSWORD_V2" in `signing\.ciSecrets\.names` and .* never reads it/);
    // Section 8 stays SILENT — the lane names whatever the register declares, so
    // this red is attributable to section 9 alone.
    assert.doesNotMatch(out, /which the register does not declare/);
  });

  test('FAILS when the register declares the variable Gradle PRODUCES as a secret', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        mutate: (r) => {
          secrets(r).names = [...ANDROID_SECRETS, 'ANDROID_KEYSTORE_PATH'];
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /reads it as Gradle's "storeFile" — the value the register's own `transport` says is PRODUCED at run time/);
    assert.match(out, /overwrites it on every run/);
  });

  // ── USE, never the declaration ────────────────────────────────────────────
  test('FAILS when the map is declared and nothing outside the declaration reads it', () => {
    const { code, out } = run(tree({ withAndroid: true, gradle: { useMap: false } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares `releaseSigningEnv` and NOTHING outside that declaration reads it/);
    assert.match(out, /assert-seams-wired\.mjs anchored on a function's own declaration/);
  });

  test('FAILS when the signing config never assigns a value the map declares', () => {
    const { code, out } = run(
      tree({ withAndroid: true, gradle: { assigns: ['storeFile', 'storePassword', 'keyPassword'] } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /declares the value "keyAlias" and the `create\("release"\)` block never assigns it/);
  });

  // 🔒 The debug fallback is UNTOUCHED in this fixture — `signingConfigs.getByName
  // ("debug")` is still there, in the same `else`. So this cannot pass by matching
  // `getByName(` generically, and it cannot be satisfied by deleting the fallback.
  test('FAILS when the release build type no longer reaches the signing config', () => {
    const { code, out } = run(tree({ withAndroid: true, gradle: { wireBuildType: false } }));
    assert.equal(code, 1, out);
    assert.match(out, /never reaches the "release" signing config through `signingConfigs\.getByName\("release"\)`/);
  });

  test('FAILS when `signingConfig` names a config the build file does not declare', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        mutate: (r) => {
          contract(r).signingConfig = 'upload';
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /declares no `create\("upload"\) \{ … \}` signing config/);
    assert.match(out, /never reaches the "upload" signing config/);
  });

  // ── prose cannot satisfy a check ──────────────────────────────────────────
  test('COVERAGE LOST when the map exists only inside a comment', () => {
    const { code, out } = run(tree({ withAndroid: true, gradle: { commentOutMap: true } }));
    assert.equal(code, 2, out);
    assert.match(out, /FAIL COVERAGE LOST/);
    assert.match(out, /declares no `val releaseSigningEnv = mapOf\(…\)` outside its comments/);
  });

  test('COVERAGE LOST when the map declares no pairs at all', () => {
    const { code, out } = run(tree({ withAndroid: true, gradle: { pairs: [] } }));
    assert.equal(code, 2, out);
    assert.match(out, /FAIL COVERAGE LOST/);
    assert.match(out, /declares no "key" to "VARIABLE" pairs/);
  });

  // ── the scan must reach what it thinks ────────────────────────────────────
  test('COVERAGE LOST when `declaredIn` resolves to no file on disk', () => {
    const { code, out } = run(tree({ withAndroid: true, omitGradleFile: true }));
    assert.equal(code, 2, out);
    assert.match(out, /FAIL COVERAGE LOST/);
    assert.match(out, /`declaredIn` template reached 0 file\(s\) on disk; REQUIRED_COVERAGE is 1/);
    assert.match(out, /Tried: apps\/subscriptiontracker\/android\/app\/build\.gradle\.kts/);
  });

  test('COVERAGE LOST when `envMap` names a symbol the build file does not declare', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        mutate: (r) => {
          contract(r).envMap = 'signingEnvNames';
        },
      }),
    );
    assert.equal(code, 2, out);
    assert.match(out, /FAIL COVERAGE LOST/);
    assert.match(out, /declares no `val signingEnvNames = mapOf\(…\)`/);
  });

  // ── the contract cannot be deleted to pass ────────────────────────────────
  test('FAILS an android row that declares ciSecrets and no gradleContract', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        mutate: (r) => {
          delete secrets(r).gradleContract;
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /ships to "android" and declares `signing\.ciSecrets\.names`, but no `signing\.ciSecrets\.gradleContract`/);
  });

  test('FAILS a NON-android row that declares a gradleContract', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        laneSecrets: ['FIXTURE_UPLOAD_KEY'],
        mutate: (r) => {
          const web = r.channels.find((c) => c.id === 'web');
          web.signing.keyKind = 'upload-key';
          web.signing.identity = 'release-keystore/upload.keystore';
          web.signing.restoreDrill = { date: '2026-07-31', required: true, note: 'drilled' };
          web.signing.ciSecrets = { names: ['FIXTURE_UPLOAD_KEY'], gradleContract: { ...contract(r) } };
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /declares `signing\.ciSecrets\.gradleContract` but ships to \["web"\], not "android"/);
  });

  // ── the transport exemption has to cost something ─────────────────────────
  test('FAILS when `transport.substitutes` names a key the map does not declare', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        mutate: (r) => {
          contract(r).transport.substitutes = 'storePath';
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /names Gradle key "storePath", and `releaseSigningEnv` declares "storeFile", "storePassword", "keyAlias", "keyPassword"/);
    assert.match(out, /transport declaration is stale/);
  });

  test('FAILS a transport exemption with no `why` — an exemption anybody can add', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        mutate: (r) => {
          delete contract(r).transport.why;
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /`transport\.why` carries no reason/);
  });

  test('FAILS a `declaredIn` that is a literal path rather than a {app} template', () => {
    const { code, out } = run(
      tree({
        withAndroid: true,
        mutate: (r) => {
          contract(r).declaredIn = 'apps/subscriptiontracker/android/app/build.gradle.kts';
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /must be a path TEMPLATE containing `\{app\}`/);
  });

  // ── `mapsOnto`: a SECOND identity through the SAME four Gradle variables ────
  // Added 2026-09-22 for apps-gov-in (O-APPS-GOV-IN-CHANNEL-APK): that row
  // declares APPSGOVIN_* and build-platforms.yml feeds each into Gradle's
  // ANDROID_* variable for ONE step. The translation must pay what the
  // transport exemption pays, and a rename on either side must still go red.
  const AGI = ['APPSGOVIN_KEYSTORE_BASE64', 'APPSGOVIN_KEYSTORE_PASSWORD', 'APPSGOVIN_KEY_ALIAS', 'APPSGOVIN_KEY_PASSWORD'];
  const AGI_MAP = { APPSGOVIN_KEYSTORE_PASSWORD: 'ANDROID_KEYSTORE_PASSWORD', APPSGOVIN_KEY_ALIAS: 'ANDROID_KEY_ALIAS', APPSGOVIN_KEY_PASSWORD: 'ANDROID_KEY_PASSWORD' };
  const AGI_WHY = 'the lane feeds each APPSGOVIN_* value into the same Gradle variable, for the apps-gov-in build step only';
  const asAppsGovIn = (r, { mapsOnto = AGI_MAP, mapsOntoWhy = AGI_WHY } = {}) => {
    secrets(r).names = [...AGI];
    secrets(r).why = Object.fromEntries(AGI.map((n) => [n, `${n} carries the apps-gov-in signing identity into CI`]));
    contract(r).transport.name = 'APPSGOVIN_KEYSTORE_BASE64';
    if (mapsOnto !== null) contract(r).mapsOnto = mapsOnto;
    if (mapsOntoWhy !== null) contract(r).mapsOntoWhy = mapsOntoWhy;
  };

  test('PASSES when `mapsOnto` translates every declared secret onto the variable Gradle reads', () => {
    const { code, out } = run(tree({ withAndroid: true, mutate: (r) => asAppsGovIn(r) }));
    assert.equal(code, 0, out);
    assert.match(out, /1 Android build file\(s\) cross-checked against the register — 4 signing value name\(s\) agree/);
  });

  test('FAILS the same names with NO `mapsOnto`: Gradle never reads APPSGOVIN_*', () => {
    const { code, out } = run(tree({ withAndroid: true, mutate: (r) => asAppsGovIn(r, { mapsOnto: null, mapsOntoWhy: null }) }));
    assert.equal(code, 1, out);
    assert.match(out, /declares "APPSGOVIN_KEY_ALIAS" in `signing\.ciSecrets\.names` and .* never reads it/);
  });

  test('FAILS a translation onto a variable the build file does not read, and names both spellings', () => {
    const { code, out } = run(
      tree({ withAndroid: true, mutate: (r) => asAppsGovIn(r, { mapsOnto: { ...AGI_MAP, APPSGOVIN_KEY_ALIAS: 'ANDROID_KEY_ALIAS_V2' } }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /carries the signing identity in ANDROID_KEY_ALIAS \(Gradle's "keyAlias"\)/);
    assert.match(out, /declares "APPSGOVIN_KEY_ALIAS" \(fed into "ANDROID_KEY_ALIAS_V2"\) in `signing\.ciSecrets\.names` and .* never reads it/);
  });

  test('FAILS a translation of a secret the row does not declare — a waiver for nothing', () => {
    const { code, out } = run(
      tree({ withAndroid: true, mutate: (r) => asAppsGovIn(r, { mapsOnto: { ...AGI_MAP, APPSGOVIN_SPARE: 'ANDROID_SPARE' } }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /`mapsOnto` translates "APPSGOVIN_SPARE", which `names` does not declare/);
  });

  test('FAILS a translation of the transport, which is not a Gradle variable', () => {
    const { code, out } = run(
      tree({ withAndroid: true, mutate: (r) => asAppsGovIn(r, { mapsOnto: { ...AGI_MAP, APPSGOVIN_KEYSTORE_BASE64: 'ANDROID_KEYSTORE_PATH' } }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /`mapsOnto` translates the transport "APPSGOVIN_KEYSTORE_BASE64"/);
  });

  test('FAILS two declared secrets fed into ONE Gradle variable', () => {
    const { code, out } = run(
      tree({ withAndroid: true, mutate: (r) => asAppsGovIn(r, { mapsOnto: { ...AGI_MAP, APPSGOVIN_KEY_PASSWORD: 'ANDROID_KEY_ALIAS' } }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /`mapsOnto` feeds both "APPSGOVIN_KEY_ALIAS" and "APPSGOVIN_KEY_PASSWORD" into "ANDROID_KEY_ALIAS"/);
  });

  test('FAILS a `mapsOnto` with no written `mapsOntoWhy` — an exemption anybody can add', () => {
    const { code, out } = run(tree({ withAndroid: true, mutate: (r) => asAppsGovIn(r, { mapsOntoWhy: 'x' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /`mapsOnto` carries no `mapsOntoWhy`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8b — a WRITTEN REASON per declared signing secret.
//
// 🔴 THE HOLE THIS CLOSES, AND WHY IT IS NOT SYMMETRY FOR ITS OWN SAKE.
// `ciSecretRegister.nonSigning` has required a `why` per entry since it was
// written, on its own stated ground: without one, the cheapest way to silence a
// [9]R-3 limb 2 failure is to paste the name into the array. That argument is
// about the PARTITION, and the SIGNING side of it had no such rule — so for any
// row section 9 cannot reach (every non-Android row) pasting a name into
// `signing.ciSecrets.names` silenced the identical failure, unreasoned and
// unreviewed, on the more expensive side of the partition.
//
// The negative cases below are the ones that matter: a name with no reason, a
// reason too short to be one, a `why` that is not a map, and a reason left
// behind by a name that has gone. The last is the `$updateExemptions` failure
// wearing different clothes — a waiver outliving the thing it waived.
describe('assert-channel-register — §8b: a declared signing secret carries a written reason', () => {
  /** A served row holding a real key whose secret the lane names — the shape in
   *  which limb 2 has a subject at all. Each case breaks exactly one thing. */
  const signingRow = (ciSecrets) => (r) => {
    const c = r.channels.find((x) => x.id === 'web');
    c.signing.keyKind = 'upload-key';
    c.signing.identity = 'release-keystore/upload.keystore';
    c.signing.restoreDrill = { date: '2026-07-31', required: true, note: 'drilled' };
    c.signing.ciSecrets = ciSecrets;
  };
  const laneNamesIt = { laneSecrets: ['FIXTURE_UPLOAD_KEY'] };
  const REASON = 'the fixture keystore this served row signs its artifact with';

  test('PASSES when every declared name carries a reason', () => {
    const { code, out } = run(
      tree({
        ...laneNamesIt,
        mutate: signingRow({ names: ['FIXTURE_UPLOAD_KEY'], why: { FIXTURE_UPLOAD_KEY: REASON } }),
      }),
    );
    assert.equal(code, 0, out);
  });

  test('FAILS when the row declares names and NO `why` map at all', () => {
    const { code, out } = run(tree({ ...laneNamesIt, mutate: signingRow({ names: ['FIXTURE_UPLOAD_KEY'] }) }));
    assert.equal(code, 1, out);
    assert.match(out, /no `signing\.ciSecrets\.why` map/);
    assert.match(out, /copy-paste, not a classification/);
  });

  test('FAILS when one name of several has no reason — not merely when all do', () => {
    const { code, out } = run(
      tree({
        laneSecrets: ['FIXTURE_UPLOAD_KEY', 'FIXTURE_UPLOAD_PASSWORD'],
        mutate: signingRow({
          names: ['FIXTURE_UPLOAD_KEY', 'FIXTURE_UPLOAD_PASSWORD'],
          why: { FIXTURE_UPLOAD_KEY: REASON },
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /declares signing secret "FIXTURE_UPLOAD_PASSWORD" with no/);
  });

  // The floor is `nonSigning`'s own 20 characters, reused rather than re-chosen.
  // A one-word "why" satisfies a presence check and justifies nothing, which is
  // the whole failure the reason exists to prevent.
  test('FAILS a reason too short to be one', () => {
    const { code, out } = run(
      tree({
        ...laneNamesIt,
        mutate: signingRow({ names: ['FIXTURE_UPLOAD_KEY'], why: { FIXTURE_UPLOAD_KEY: 'signing' } }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /at least 20 characters/);
  });

  test('FAILS a `why` that is an array rather than a name-to-reason map', () => {
    const { code, out } = run(
      tree({ ...laneNamesIt, mutate: signingRow({ names: ['FIXTURE_UPLOAD_KEY'], why: [REASON] }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /no `signing\.ciSecrets\.why` map/);
  });

  // The converse, and it is the `$updateExemptions` rule one level over: a
  // reason for a name the row no longer declares reads as a live classification.
  test('FAILS a reason left behind by a name that is gone', () => {
    const { code, out } = run(
      tree({
        ...laneNamesIt,
        mutate: signingRow({
          names: ['FIXTURE_UPLOAD_KEY'],
          why: { FIXTURE_UPLOAD_KEY: REASON, FIXTURE_RETIRED_KEY: REASON },
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /records `signing\.ciSecrets\.why\["FIXTURE_RETIRED_KEY"\]` and does not declare/);
  });

  // `_why` is this register's prose namespace and appears inside these blocks in
  // the real file. Reading it as an undeclared secret name would fail the real
  // tree — the false positive that gets a guard disabled rather than fixed.
  test('PASSES a `why` map carrying an `_why` prose key beside the reasons', () => {
    const { code, out } = run(
      tree({
        ...laneNamesIt,
        mutate: signingRow({
          names: ['FIXTURE_UPLOAD_KEY'],
          why: { _why: ['prose about the block, not a secret name'], FIXTURE_UPLOAD_KEY: REASON },
        }),
      }),
    );
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6d — a pinned certificate fingerprint or public key, and its sentinel.
//
// 🔴 WHY A PIN NEEDS ITS OWN READER, IN THE REGISTER'S OWN WORDS. The Play row's
// `uploadCertificate._aliasNote` records its `alias` field drifting to a stale
// value with NOTHING NOTICING, because the only consumer reads `.sha256` alone:
// "a value with no reader drifts silently and its `asOf` date goes on looking
// fresh." The windows-direct and linux-appimage pins added 2026-08-08 would have
// been two more of those. These cases are what stops that.
//
// The middle state is the expensive one and it has its own case: SOME fields
// real and some still the sentinel is the identity that packages and ships
// cleanly under the wrong name — `packageIdentity`'s own _why calls that
// unrecoverable once published, which is why it fails rather than waits.
describe('assert-channel-register — §6d: pinned signing material and its sentinel', () => {
  const SENTINEL = 'CERT-NOT-PURCHASED';
  const pin = (over = {}) => ({
    notYetConfiguredSentinel: SENTINEL,
    sha256: SENTINEL,
    subject: SENTINEL,
    asOf: '2026-08-08',
    source: 'transcribed from the issued certificate on the day the purchase completes',
    ...over,
  });
  /** Hang the pin on the DEFERRED row by default — the state the real tree is in. */
  const onDeferred = (over) => (r) => {
    r.channels.find((c) => c.id === 'windows-store').signing.codeSigningCertificate = pin(over);
  };
  const onServed = (over) => (r) => {
    r.channels.find((c) => c.id === 'web').signing.codeSigningCertificate = pin(over);
  };

  test('PRINTS, and does not fail, a DEFERRED row whose pin is still all sentinel', () => {
    const { code, out } = run(tree({ mutate: onDeferred() }));
    assert.equal(code, 0, out);
    assert.match(out, /SIGNING PIN NOT CONFIGURED/);
    assert.match(out, /windows-store" signing\.codeSigningCertificate/);
  });

  test('PASSES a fully configured pin, and counts it', () => {
    const { code, out } = run(tree({ mutate: onDeferred({ sha256: 'AA:BB:CC', subject: 'CN=Nikatru' }) }));
    assert.equal(code, 0, out);
    assert.match(out, /1 pinned signing-material block\(s\), 1 configured/);
  });

  // The case the whole limb exists for.
  test('FAILS a HALF configured pin — one field real, one still the sentinel', () => {
    const { code, out } = run(tree({ mutate: onDeferred({ sha256: 'AA:BB:CC' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /is HALF CONFIGURED/);
    assert.match(out, /ships cleanly under the wrong name/);
  });

  // A deferred row PRINTS the same state; a SERVED one cannot, because a channel
  // cannot publish through an identity that does not exist.
  test('FAILS a SERVED row whose pin is still on the sentinel', () => {
    const { code, out } = run(tree({ mutate: onServed() }));
    assert.equal(code, 1, out);
    assert.match(out, /The row is SERVED\./);
  });

  test('FAILS a pin with no `asOf` — an undated claim about an external artefact', () => {
    const { code, out } = run(tree({ mutate: onDeferred({ asOf: undefined }) }));
    assert.equal(code, 1, out);
    assert.match(out, /carries no `asOf` date/);
  });

  test('FAILS a pin with no `source` — a value that arrived from nowhere', () => {
    const { code, out } = run(tree({ mutate: onDeferred({ source: undefined }) }));
    assert.equal(code, 1, out);
    assert.match(out, /carries no `source`/);
  });

  test('FAILS a sentinel that is not a non-empty string', () => {
    const { code, out } = run(tree({ mutate: onDeferred({ notYetConfiguredSentinel: '' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /`notYetConfiguredSentinel` that is not a non-empty string/);
  });

  // An empty pin block satisfies every check by having nothing to check — the
  // empty-domain pass section 1 exists to remove, one level down.
  test('FAILS a pin block declaring a sentinel and NO value field', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => {
          r.channels.find((c) => c.id === 'windows-store').signing.codeSigningCertificate = {
            notYetConfiguredSentinel: SENTINEL,
            asOf: '2026-08-08',
            source: 'transcribed from the issued certificate on the day the purchase completes',
          };
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /NO value field for it to stand in for/);
  });

  // `alias` names a keystore ENTRY whose authority is a repository secret, not a
  // value the pin identifies — so it must not demand a sentinel of its own. The
  // real android-play row carries one, and reading it as a value field would
  // report the live upload-certificate pin as HALF CONFIGURED on every run.
  test('does not treat the bookkeeping fields as pinned values', () => {
    const { code, out } = run(
      tree({
        mutate: onDeferred({
          sha256: 'AA:BB:CC',
          subject: 'CN=Nikatru',
          alias: 'nikatru-upload',
          declaredIn: 'somewhere',
        }),
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /1 configured/);
  });

  // A block with no sentinel at all is not a pin block and must not acquire the
  // checks: android-play's `uploadCertificate` is exactly that shape today, and
  // firing on it would fail the real tree for a certificate that IS configured.
  test('ignores a signing block that declares no sentinel', () => {
    const { code, out } = run(
      tree({
        mutate: (r) => {
          r.channels.find((c) => c.id === 'windows-store').signing.uploadCertificate = { sha256: 'AA:BB', alias: 'x' };
        },
      }),
    );
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /pinned signing-material block/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6e — the MSIX Package Family Name, recomputed from the publisher (2026-09-22).
//
// The known answer is the REAL pair: identityName, publisher and PFN are public
// in every package the Store serves, and Partner Center printed the PFN beside
// them. A publisherId() that drifts cannot still yield `ab30hnb4490ma` for it,
// so the first test IS the algorithm's pin. The two failing publishers are the
// mistakes the limb exists for: one digit off, and the CN in lower case — each
// typed IDENTICALLY into both copies, which every copy-vs-copy guard accepts.
describe('assert-channel-register — §6e: the Package Family Name is derived, not trusted', () => {
  const SENTINEL = 'PARTNER-CENTER-PENDING';
  const REAL = {
    identityName: '60210NIKATRU.NikatruSubscriptionTracker',
    publisherDisplayName: 'NIKATRU',
    publisher: 'CN=9D0DEF58-EDA2-448E-9498-42C2C3083994',
    packageFamilyName: '60210NIKATRU.NikatruSubscriptionTracker_ab30hnb4490ma',
  };
  const PENDING = {
    identityName: SENTINEL,
    publisherDisplayName: SENTINEL,
    publisher: `CN=${SENTINEL}`,
  };
  const identity = (values) => (r) => {
    r.channels.find((c) => c.id === 'windows-store').packageIdentity = {
      notYetConfiguredSentinel: SENTINEL,
      ...values,
      declaredIn: 'apps/{app}/pubspec.yaml → msix_config',
    };
  };

  test('PASSES the real pair — the known answer `ab30hnb4490ma` Partner Center printed', () => {
    const { code, out } = run(tree({ mutate: identity(REAL) }));
    assert.equal(code, 0, out);
    assert.match(out, /1 MSIX package identity: 1 configured with its Package Family Name recomputed/);
  });

  test('FAILS a publisher one digit off (…3995), typed the same way in both copies', () => {
    const { code, out } = run(tree({ mutate: identity({ ...REAL, publisher: 'CN=9D0DEF58-EDA2-448E-9498-42C2C3083995' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /packageFamilyName is "60210NIKATRU\.NikatruSubscriptionTracker_ab30hnb4490ma"/);
    assert.match(out, /publisher id "b71dt9xvs34za" against "ab30hnb4490ma"/);
    // A FAIL for the row and a pass line counting it "configured" would be two
    // answers; the pass line prints only when §6e found nothing.
    assert.doesNotMatch(out, /MSIX package identit/);
  });

  test('FAILS the same CN in lower case — the hash is over the exact string', () => {
    const { code, out } = run(tree({ mutate: identity({ ...REAL, publisher: 'CN=9d0def58-eda2-448e-9498-42c2c3083994' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /publisher id "gex56p498cnxe" against "ab30hnb4490ma"/);
  });

  test('FAILS a configured identity that declares no packageFamilyName', () => {
    const noPfn = { ...REAL };
    delete noPfn.packageFamilyName;
    const { code, out } = run(tree({ mutate: identity(noPfn) }));
    assert.equal(code, 1, out);
    assert.match(out, /is configured but declares no `packageFamilyName`/);
  });

  test('PASSES the sentinel row with no PFN — not yet configured is not a failure', () => {
    const { code, out } = run(tree({ mutate: identity(PENDING) }));
    assert.equal(code, 0, out);
    assert.match(out, /1 MSIX package identity: 0 configured .* 1 not yet configured/);
  });

  test('FAILS a PFN that exists before its inputs do', () => {
    const { code, out } = run(tree({ mutate: identity({ ...PENDING, packageFamilyName: REAL.packageFamilyName }) }));
    assert.equal(code, 1, out);
    assert.match(out, /while every identity field still reads "PARTNER-CENTER-PENDING"/);
  });

  test('FAILS a HALF configured identity — the display name left on the sentinel', () => {
    const { code, out } = run(tree({ mutate: identity({ ...REAL, publisherDisplayName: SENTINEL }) }));
    assert.equal(code, 1, out);
    assert.match(out, /packageIdentity is HALF configured: `publisherDisplayName` still read/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the two tables lifted out of tooling/store-pipeline/ on 2026-08-20,
// which was deleted in the same commit.
//
// 🔴 THESE TESTS ARE THE POINT OF THE LIFT. The tables previously lived in a
// directory NOTHING ran — no workflow, no guard, no meta-guard — so the checks
// over them had stopped being performed long before the directory was removed.
// Moving the data without moving the check would have been a slower deletion.
// Each case below is a mutation that was run by hand against the real register
// before this suite existed, and each one turned the guard red.
describe('assert-channel-register — §10 artifactBuild and the signing seams', () => {
  test('M1 the whole artifactBuild block deleted is caught', () => {
    const { code, out } = run(tree({ breakArtifactBuild: (r) => { delete r.artifactBuild; } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no `artifactBuild\.formats` block/);
    // The message must carry WHY it matters, not just that it is absent.
    assert.match(out, /nothing says that `\.aab` comes from `flutter build appbundle`/);
  });

  test('M2 a format a channel declares with no build verb is caught', () => {
    const { code, out } = run(tree({ breakArtifactBuild: (r) => { delete r.artifactBuild.formats['static-bundle']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /format "static-bundle" is declared by a channel/);
  });

  test('M3 a build verb for a format NO channel declares is caught', () => {
    const { code, out } = run(tree({
      // `packagedBy` carries the sentinel so limb (iii) stays silent: `.deb` is
      // emitted by no lane either, and two failures for one mutation is a red
      // result nobody can attribute.
      breakArtifactBuild: (r) => { r.artifactBuild.formats['.deb'] = { flutterTarget: 'linux', packagedBy: FIXTURE_UNPACKAGED }; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /describes a build verb for a format NO channel declares/);
  });

  test('an entry with NO build verb is caught — one of the two is the whole content of the entry', () => {
    const { code, out } = run(tree({
      breakArtifactBuild: (r) => { r.artifactBuild.formats['static-bundle'] = { packagedBy: null }; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /names no build verb — neither a `flutterTarget` nor a `packVerb`/);
  });

  // 🔴 THE OTHER HALF OF THE SAME CLAUSE, ADDED 2026-09-05 WITH `packVerb`.
  // The extension surface has no Flutter target — its artifact is the source
  // tree zipped by extensions/scripts/pack.mjs — so an entry names ONE verb and
  // which field it uses is the surface's answer. BOTH is refused as firmly as
  // NEITHER: two build verbs for one format is two answers to "where does this
  // artifact come from", and the second is the one that goes stale.
  test('a packVerb ALONE satisfies the build-verb clause — the extension surface has no flutterTarget', () => {
    const { code, out } = run(tree({
      breakArtifactBuild: (r) => {
        r.artifactBuild.formats['static-bundle'] = { packVerb: 'node extensions/scripts/pack.mjs <tool>', packagedBy: null };
      },
    }));
    assert.equal(code, 0, out);
  });

  test('an entry naming BOTH a flutterTarget and a packVerb is caught', () => {
    const { code, out } = run(tree({
      breakArtifactBuild: (r) => {
        r.artifactBuild.formats['static-bundle'] = { flutterTarget: 'web', packVerb: 'node scripts/pack.mjs', packagedBy: null };
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /names BOTH a `flutterTarget` and a `packVerb`/);
  });

  test('M5 a kind:"store" channel with no signing.seam is caught', () => {
    const { code, out } = run(tree({ mutate: (r) => { delete r.channels[1].signing.seam; } }));
    assert.equal(code, 1, out);
    assert.match(out, /is kind:"store" and carries no `signing\.seam`/);
  });

  test('M4 a seam naming a script that does not exist is caught', () => {
    const { code, out } = run(tree({
      mutate: (r) => { r.channels[1].signing.seam.verify = 'tooling/ci/does-not-exist.mjs'; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /which does not exist/);
    assert.match(out, /a seam pointing at a script that is gone is a seam nobody can run/i);
  });

  test('a seam with no written `why` is caught — an unexplained null is an omission', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].signing.seam.why = ''; } }));
    assert.equal(code, 1, out);
    assert.match(out, /carries no written `why`/);
  });

  // ── anti-vacuity ──────────────────────────────────────────────────────────
  test('COVERAGE LOST when no channel declares any artifactFormats', () => {
    const { code, out } = run(tree({ mutate: (r) => { for (const c of r.channels) c.artifactFormats = []; } }));
    assert.equal(code, 1, out);
    // It must say the cross-check ranged over nothing, not merely pass.
    assert.match(out, /COVERAGE LOST|no `artifactFormats`/);
  });

  // ── limb (iii), 2026-08-25 · a format NO LANE EMITS may not name a packager ──
  // The real defect: `.AppImage` said "AppImage packaging — tooling/ci/appimage-signing.mjs
  // and its lane", `.pkg` said "productbuild + notarisation", `.ipa` said `null`, and the
  // guard exited 0 over all three. Direction proven against the REAL tree before these cases
  // were written: with the limb added and the register text UNCHANGED,
  // `node tooling/ci/assert-channel-register.mjs` exited 1 with exactly three FAIL lines
  // (.ipa, .pkg, .AppImage); with the three corrections appended it exits 0 and prints
  // "3 declared format(s) emitted by NONE, 3 of which say so with the NOT-IMPLEMENTED sentinel".
  //
  // 🔴 THE FIXTURE'S EMITTED SET IS ONE FORMAT WIDE AND THAT IS THE POINT. The lane workflow
  // runs `flutter build web`, so `static-bundle` IS emitted and `.msix` is NOT — one tree
  // carrying both input classes, which is what a single-fixture test of this limb cannot
  // express. `LIVE_CLAIM` below is the SAME string on both, so the two verdicts differ on
  // emission and on nothing else.
  const LIVE_CLAIM = 'packaged by tooling/ci/appimage-signing.mjs in its lane, on every release run.';

  test('FAILS when a format NO lane emits names a live packager', () => {
    const { code, out } = run(tree({ packagedBy: { '.msix': LIVE_CLAIM } }));
    assert.equal(code, 1, out);
    assert.match(out, /artifactBuild\.formats\["\.msix"\] describes a packaging step and NO lane this register names emits "\.msix"/);
    assert.match(out, /reads as a live packaging step/);
    // It must say what the lanes DO emit, or the reader cannot tell a false claim
    // from a scan that stopped reaching the workflows.
    assert.match(out, /The lanes emit "static-bundle" and nothing else/);
  });

  // 🔴 THE TRAP THIS LIMB WAS WRITTEN AROUND. "packagedBy must name a path that
  // exists" is GREEN on the real `.AppImage` entry, because tooling/ci/appimage-signing.mjs
  // is a real file — it signs, it does not package. Here the named file is written
  // into the fixture root, so the existence-keyed limb would pass and this one
  // must still fail: it is the VERB that is false, not the path.
  test('FAILS even when the named packaging script really is on disk', () => {
    const { code, out } = run(
      tree({
        packagedBy: { '.msix': LIVE_CLAIM },
        extraFiles: { 'tooling/ci/appimage-signing.mjs': '// a real file that signs and does not package\n' },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /NO lane this register names emits "\.msix"/);
  });

  // `null` is a claim: "the build verb leaves the artifact and nothing further is
  // needed". True of `.aab`; a lie about a verb no workflow runs, which is what the
  // real `.ipa` entry was. Without this case the limb would be an opt-out — delete
  // the sentence and pass.
  test('FAILS when a format NO lane emits carries packagedBy: null', () => {
    const { code, out } = run(tree({ packagedBy: { '.msix': null } }));
    assert.equal(code, 1, out);
    assert.match(out, /artifactBuild\.formats\["\.msix"\]/);
    assert.match(out, /`packagedBy` is null/);
  });

  // 🔴 THE INPUT CLASS A SINGLE FIXTURE CANNOT EXPRESS — the negative control.
  // The SAME live-sounding string on a format the lane really does emit must pass,
  // or the limb is "no packagedBy string is ever allowed" wearing a longer message.
  test('PASSES when the very same live claim sits on a format the lane DOES emit', () => {
    const { code, out } = run(tree({ packagedBy: { 'static-bundle': LIVE_CLAIM } }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /describes a packaging step and NO lane/);
  });

  test('the NOT-IMPLEMENTED sentinel is what closes it, and the count is printed', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    // 1 emitted (static-bundle, from `flutter build web` in the lane), 1 declared
    // and emitted by nothing (.msix), and that one carries the sentinel.
    assert.match(
      out,
      /artifactBuild packagers — 1 format\(s\) emitted by a lane; 1 declared format\(s\) emitted by NONE, 1 of which say so/,
    );
  });

  // The count is a measurement, not decoration: emitting `.msix`'s platform in
  // another format must not change it, but emitting nothing at all must.
  test('a format moves out of the "emitted by NONE" count when a lane starts emitting it', () => {
    const before = run(tree({ mutate: (r) => { r.channels[1].artifactFormats = ['.exe']; } }));
    assert.equal(before.code, 0, before.out);
    assert.match(before.out, /1 declared format\(s\) emitted by NONE/);

    const after = run(
      tree({
        windowsRun: 'flutter build windows --release --dart-define=RELEASE_CHANNEL=windows-store',
        mutate: (r) => { r.channels[1].artifactFormats = ['.exe']; },
      }),
    );
    assert.equal(after.code, 0, after.out);
    assert.match(after.out, /2 format\(s\) emitted by a lane; 0 declared format\(s\) emitted by NONE/);
  });

  test('the real register passes both limbs, and says what it measured', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /artifactBuild — \d+ format\(s\), every one declared by a channel/);
    assert.match(out, /signing seams — \d+ channel\(s\) carry one/);
  });

  // ── limb (iv), 2026-09-24 · the read-back runs where the artifact is made ──
  // (O-STORE-BUILD-GUARD-GRADES-DECLARED-JOBS-ONLY, amended closes.) Each case
  // declares `.msix` packagerCommand "msix:create", points the windows-store
  // row's seam.verify at a stub, and writes ONE workflow whose steps ARE the
  // case, so every verdict below is about step order and nothing else. The
  // real-tree evidence is the R9 case at the end of this block, and the PR's
  // mutation of submit-windows-store.yml#submit.
  const MSIX_VERIFY = 'tooling/ci/assert-artifact-signed-msix.mjs';
  const MSIX_WORKFLOW = '.github/workflows/package-msix.yml';
  // Line 9 of the written file is this step's `run:`; the finding cites it.
  const PACKAGE_STEP = ['      - name: Package MSIX', '        run: dart run msix:create --version=1.0.0.0'];
  const READ_BACK = ['      - name: Read the package back', `        run: node ${MSIX_VERIFY} build/app.msix`];
  const UPLOAD_ALWAYS = [
    '      - name: Keep the package',
    '        if: always()',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: diagnostic',
    '          path: build/app.msix',
  ];
  const msixTree = ({ steps, packagerCommand = 'msix:create', verify = MSIX_VERIFY }) =>
    tree({
      mutate: (r) => { r.channels[1].signing.seam.verify = verify; },
      breakArtifactBuild: (r) => { r.artifactBuild.formats['.msix'].packagerCommand = packagerCommand; },
      extraFiles: {
        [MSIX_VERIFY]: '// fixture stub: limb (iv) asks only where this runs\n',
        [MSIX_WORKFLOW]: ['name: Package msix', 'on:', '  workflow_dispatch:', 'jobs:', '  package:', '    runs-on: windows-2025', '    steps:', ...steps, ''].join(NL),
      },
    });

  test('limb (iv) GREEN: read-back straight after the packager, then an always() upload and a step gated on a LATER success', () => {
    const { code, out } = run(msixTree({
      steps: [
        ...PACKAGE_STEP,
        ...READ_BACK,
        ...UPLOAD_ALWAYS,
        '      - name: Hand the package over',
        '        id: handover',
        '        run: node tooling/release/hand-over.mjs build/app.msix',
        '      - name: Record the hand-over',
        "        if: always() && steps.handover.outcome == 'success'",
        '        run: echo recorded',
      ],
    }));
    assert.equal(code, 0, out);
    assert.match(out, /read-back where the artifact is made — 1 packaging step\(s\) in 1 job\(s\), for "\.msix"/);
    // The gap is printed, not hidden: a format with prose packagedBy and no packagerCommand.
    assert.match(out, /read-back census does not cover "static-bundle"/);
  });

  test('limb (iv) FAILS a job that packages and uploads with no read-back at all', () => {
    const { code, out } = run(msixTree({ steps: [...PACKAGE_STEP, ...UPLOAD_ALWAYS] }));
    assert.equal(code, 1, out);
    assert.match(out, /package-msix\.yml:9 \(job "package"\) packages \.msix with "msix:create" and the next step is "Keep the package", not tooling\/ci\/assert-artifact-signed-msix\.mjs/);
  });

  test('limb (iv) R4 FAILS a read-back that comes AFTER the upload', () => {
    const { code, out } = run(msixTree({ steps: [...PACKAGE_STEP, ...UPLOAD_ALWAYS, ...READ_BACK] }));
    assert.equal(code, 1, out);
    assert.match(out, /package-msix\.yml:9 \(job "package"\) packages \.msix with "msix:create" and the next step is "Keep the package"/);
  });

  test('limb (iv) R5 FAILS a read-back carrying continue-on-error: true', () => {
    const { code, out } = run(msixTree({ steps: [...PACKAGE_STEP, READ_BACK[0], '        continue-on-error: true', READ_BACK[1]] }));
    assert.equal(code, 1, out);
    assert.match(out, /reads back \.msix and carries `continue-on-error: true`/);
  });

  test('limb (iv) R5 FAILS a read-back whose command ends in || true', () => {
    const { code, out } = run(msixTree({ steps: [...PACKAGE_STEP, READ_BACK[0], `        run: node ${MSIX_VERIFY} build/app.msix || true`] }));
    assert.equal(code, 1, out);
    assert.match(out, /reads back \.msix and its command carries `\|\| true`/);
  });

  test('limb (iv) FAILS a read-back under an if: that can skip it', () => {
    const { code, out } = run(msixTree({ steps: [...PACKAGE_STEP, READ_BACK[0], "        if: github.event_name == 'push'", READ_BACK[1]] }));
    assert.equal(code, 1, out);
    assert.match(out, /reads back \.msix under `if: github\.event_name == 'push'`/);
  });

  test('limb (iv) R6 COVERAGE LOST (exit 2) when the packagerCommand matches no step', () => {
    const { code, out } = run(msixTree({ packagerCommand: 'msix:build', steps: [...PACKAGE_STEP, ...READ_BACK] }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — artifactBuild\.formats\["\.msix"\] declares packagerCommand "msix:build" and no step/);
  });

  test('limb (iv) R7 FAILS a non-upload step that runs on always() after the read-back', () => {
    const { code, out } = run(msixTree({
      steps: [
        ...PACKAGE_STEP,
        ...READ_BACK,
        '      - name: Hand the package over anyway',
        '        if: always()',
        '        run: node tooling/release/hand-over.mjs build/app.msix',
      ],
    }));
    assert.equal(code, 1, out);
    assert.match(out, /step "Hand the package over anyway" runs on `if: always\(\)` after the read-back/);
  });

  test('limb (iv) FAILS an always() step gated on the success of a step BEFORE the read-back', () => {
    const { code, out } = run(msixTree({
      steps: [
        '      - name: Package MSIX',
        '        id: pack',
        '        run: dart run msix:create --version=1.0.0.0',
        ...READ_BACK,
        '      - name: Hand the package over',
        "        if: always() && steps.pack.outcome == 'success'",
        '        run: node tooling/release/hand-over.mjs build/app.msix',
      ],
    }));
    assert.equal(code, 1, out);
    assert.match(out, /step "Hand the package over" runs on `if: always\(\) && steps\.pack\.outcome == 'success'` after the read-back/);
  });

  test('limb (iv) (a) FAILS a packagerCommand when no row declaring the format carries a seam.verify', () => {
    const { code, out } = run(msixTree({ verify: null, steps: [...PACKAGE_STEP, ...READ_BACK] }));
    assert.equal(code, 1, out);
    assert.match(out, /declares packagerCommand "msix:create" and no row declaring "\.msix" carries a non-null `signing\.seam\.verify`/);
  });

  // R9's static half. The verifier's own suite proves a wrong identity exits 1
  // (artifact-signed-msix.test.mjs, "the declaration is compared to the BYTES").
  // This reads the REAL workflows directly, not through the guard, and asks the
  // other half: once the read-back exits 1, nothing in its job carries on past it
  // except an upload, or a step gated on the success of a later step.
  test('R9 the REAL tree: every .msix read-back can stop its job, and only an upload runs past a refused one', () => {
    const REPO = resolve(CI_DIR, '..', '..');
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling/channel-register.json'), 'utf8'));
    const cmd = reg.artifactBuild.formats['.msix'].packagerCommand;
    const verify = reg.channels.find((c) => c.id === 'windows-store').signing.seam.verify;
    assert.equal(typeof cmd, 'string');
    assert.equal(typeof verify, 'string');
    const bodyOf = (job, step) => job.lines.filter((l) => l.n >= step.first && l.n <= step.last).map((l) => l.text).join(NL);
    const readBacks = [];
    let packagingSteps = 0;
    for (const wf of parseAllWorkflows(REPO)) {
      for (const [jobName, job] of wf.jobs) {
        const steps = workflowSteps(job);
        for (const step of steps) {
          const text = step.run ? joinShellContinuations(step.run.text) : '';
          if (shellSegments(text).some((s) => s.trim().split(/\s+/).includes(cmd))) packagingSteps++;
          if (text.includes(`node ${verify} `)) readBacks.push({ wf, jobName, job, step, steps });
        }
      }
    }
    assert.ok(readBacks.length > 0, 'no workflow step runs the .msix read-back');
    assert.equal(readBacks.length, packagingSteps, `${readBacks.length} read-back step(s) for ${packagingSteps} packaging step(s)`);
    for (const { wf, jobName, job, step, steps } of readBacks) {
      const where = `${wf.rel} job "${jobName}", the read-back at line ${step.first}`;
      assert.doesNotMatch(bodyOf(job, step), /continue-on-error/, where);
      assert.doesNotMatch(step.run.text, /\|\|/, where);
      assert.equal(step.cond, null, where);
      for (const later of steps.slice(step.index + 1)) {
        if (later.cond === null || !/\b(?:always|failure|cancelled)\(\)/.test(later.cond)) continue;
        const isUpload = /uses:\s*actions\/upload-artifact@/.test(bodyOf(job, later));
        const gate = later.cond.match(/^always\(\)\s*&&\s*steps\.([A-Za-z0-9_-]+)\.outcome\s*==\s*'success'$/);
        const gatedOnLater = gate !== null && steps.some((s) => s.id === gate[1] && s.index > step.index && s.index < later.index && s.cond === null);
        assert.ok(isUpload || gatedOnLater, `${where}: the step at line ${later.first} runs on \`${later.cond}\` past it and is not an upload`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE EXTENSION SURFACE — every kind:"store" obligation, asked of a channel
// whose product is a browser extension rather than a Flutter app. Added
// 2026-09-05 with the chrome-webstore / edge-addons / amo rows.
//
// 🔴 THE POINT OF THESE CASES IS THAT NOTHING WAS DROPPED. Each one mutates the
// extension-surface counterpart of an app-side clause and asserts the guard
// still bites: the listing-tree template, the store key, the submittable flag
// and the publisher-account question. Two of them are STRONGER than the app-side
// clause they replace, because they are checked against disk rather than against
// the shape of a string — and both of those are proved by deleting a real
// directory, not by editing a field.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — the extension surface carries the store obligations', () => {
  test('GREEN CONTROL — an extension store row with its subtree present passes', () => {
    const { code, out } = run(tree({ withExtension: true }));
    assert.equal(code, 0, out);
  });

  test('FAILS when the storeMetadataDir template has no {tool}', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { r.channels.at(-1).storeMetadataDir = 'extensions/Extension/Full_Screen_Shot/store/chrome'; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /no `storeMetadataDir` template containing \{tool\}/);
  });

  test('FAILS when the listing directory the template names is NOT on disk', () => {
    const { code, out } = run(tree({ withExtension: true, omitExtensionStoreDir: true }));
    assert.equal(code, 1, out);
    assert.match(out, /and that directory does not exist/);
  });

  test('FAILS for a SECOND tool whose listing directory is missing — the loop is per-tool', () => {
    const { code, out } = run(tree({ withExtension: true, extensionToolDirs: ['Full_Screen_Shot', 'Context_Guard'] }));
    // Both trees are written, so this is the green control for the case below.
    assert.equal(code, 0, out);
  });

  test('FAILS when the tool.json does not declare the store the row names', () => {
    const { code, out } = run(tree({
      withExtension: true,
      toolJsonStores: { firefox: { target: 'firefox', dir: 'store/firefox', served: false } },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /A store this register claims and the tool has never heard of/);
  });

  test('FAILS when tool.json puts the store somewhere else — two declarations of one directory', () => {
    const { code, out } = run(tree({
      withExtension: true,
      toolJsonStores: { chrome: { target: 'chromium', dir: 'store/chrome-web-store', served: false } },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /Two declarations of one listing directory/);
  });

  test('FAILS when extensionStoreKey disagrees with the template it is supposed to name', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { r.channels.at(-1).extensionStoreKey = 'edge'; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /Two spellings of one store id/);
  });

  // ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT — `extensionRedirectUri`, one case per shape.
  test('PASSES with extensionRedirectUri null — a null refuses the channel, and is the dark launch', () => {
    const { code, out } = run(tree({ withExtension: true }));
    assert.equal(code, 0, out);
  });

  test('PASSES with a Chromium redirect of the real shape: https://<32 a-p>.chromiumapp.org/', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { r.channels.at(-1).extensionRedirectUri = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'; },
    }));
    assert.equal(code, 0, out);
  });

  test('PASSES with a Firefox redirect of the real shape on a firefox row: https://<40 hex>.extensions.allizom.org/', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => {
        const row = r.channels.at(-1);
        row.platforms = ['firefox'];
        row.extensionRedirectUri = 'https://35b64b676900f491c00e7f618d43f7040e88422e.extensions.allizom.org/';
      },
    }));
    // The fixture's other limbs are chrome-shaped; only this limb's verdict is graded.
    assert.doesNotMatch(out, /extensionRedirectUri/, out);
  });

  test('FAILS when a Firefox-shaped redirect sits on a Chromium row — the shape follows the platform', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { r.channels.at(-1).extensionRedirectUri = 'https://35b64b676900f491c00e7f618d43f7040e88422e.extensions.allizom.org/'; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /is not the shape identity\.getRedirectURL\(\) returns/);
  });

  test('R13 — FAILS on https://abc.chromiumapp.org/ (not 32 a-p characters)', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { r.channels.at(-1).extensionRedirectUri = 'https://abc.chromiumapp.org/'; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /declares extensionRedirectUri "https:\/\/abc\.chromiumapp\.org\/"/);
  });

  test('FAILS when the row carries no extensionRedirectUri key at all — null is a value, absence is not', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { delete r.channels.at(-1).extensionRedirectUri; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /no `extensionRedirectUri` key/);
  });

  test('FAILS when the row carries no extensionStoreKey at all', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { delete r.channels.at(-1).extensionStoreKey; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /no `extensionStoreKey`/);
  });

  test('FAILS when submittable:true carries no submission block — the flag cannot be a free claim', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { r.channels.at(-1).submittable = true; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /is `submittable: true` with no `submission` block/);
  });

  test('FAILS when a submission block is declared and submittable stays false', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => {
        r.channels.at(-1).submission = { script: 'tooling/release/submit-chrome.mjs', workflow: '.github/workflows/x.yml', job: 'dry-run' };
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /declares a `submission` block and is not `submittable`/);
  });

  test('FAILS when neither an ownerQueue id nor a dated open account answers [10]D-4', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { r.channels.at(-1).accountStatus = { status: 'none', asOf: '2026-08-12', note: 'no account' }; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /neither an `ownerQueue` id nor a dated `accountStatus`/);
  });

  test('an undated open account is NOT an answer — the date is what makes it ageable', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => { r.channels.at(-1).accountStatus = { status: 'live', asOf: null, note: 'no date' }; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /neither an `ownerQueue` id nor a dated `accountStatus`/);
  });

  test('an ownerQueue id alone still satisfies [10]D-4, exactly as on an app row', () => {
    const { code, out } = run(tree({
      withExtension: true,
      mutate: (r) => {
        const row = r.channels.at(-1);
        row.ownerQueue = 'A-99';
        row.accountStatus = { status: 'none', asOf: '2026-08-12', note: 'no account yet' };
      },
    }));
    assert.equal(code, 0, out);
  });
});

describe('assert-channel-register — the extension lane is COMPARED, not assumed', () => {
  test('GREEN CONTROL — a lane running `pack.mjs --target chromium` resolves the row\'s .zip', () => {
    const { code, out } = run(tree({ withExtension: true, extensionLane: true }));
    assert.equal(code, 0, out);
  });

  test('COVERAGE LOST when the lane runs no pack verb — the comparison would range over nothing', () => {
    const { code, out } = run(tree({ withExtension: true, extensionLane: true, extensionLaneBuilds: false }));
    assert.equal(code, 2, out);
    assert.match(out, /name a lane and the lane scan resolved NO emitted format/);
  });

  test('an UNMAPPED pack target is PRINTED — a verb this guard has no artifact mapping for', () => {
    const { code, out } = run(tree({
      withExtension: true,
      extensionLane: true,
      extraFiles: {
        '.github/workflows/extensions.yml': [
          'name: extensions',
          'on:',
          '  push:',
          '    tags: [subscriptiontracker-v1]',
          'jobs:',
          '  release:',
          '    runs-on: ubuntu-24.04',
          '    steps:',
          '      - name: Build package',
          '        run: node scripts/pack.mjs fullshot --target chromium --out dist',
          '      - name: Build the future',
          '        run: node scripts/pack.mjs fullshot --target safari --out dist',
          '',
        ].join(NL),
      },
    }));
    assert.equal(code, 0, out);
    assert.match(out, /UNMAPPED PACK TARGET\(S\): "safari"/);
  });

  // 🔴 THIS CASE USED TO ASSERT A PRINT AND EXIT 0, AND THE CHANGE IS RECORDED
  // RATHER THAN QUIETLY MADE. It read: the row accepts `.crx`, the lane emits
  // `.zip`, so PRINT a format gap. That comparison only existed because the pack
  // target's formats were HARD-CODED to `['.zip']` in the guard — a second copy
  // of the register's `artifactBuild` block, and the copy that could not drift
  // loudly. Now that the format set is derived from `artifactBuild.formats`
  // (every entry declaring `surface: "extension"`), a register whose only
  // extension format is NOT declared as pack-built resolves NO emitted format at
  // all, and that is COVERAGE LOST — exit 1, not a print. The outcome got
  // STRONGER, not weaker: the same tree that used to print a note now fails the
  // build, and the note it used to print was derived from a list nobody
  // maintained.
  test('a register whose extension format is not declared pack-built is COVERAGE LOST, not a quiet pass', () => {
    const { code, out } = run(tree({
      withExtension: true,
      extensionLane: true,
      mutate: (r) => { r.channels.at(-1).artifactFormats = ['.crx']; },
      breakArtifactBuild: (r) => { r.artifactBuild.formats['.crx'] = { flutterTarget: 'web', packagedBy: 'NOT IMPLEMENTED ANYWHERE IN THIS REPOSITORY' }; },
    }));
    assert.equal(code, 2, out);
    assert.match(out, /extension store row\(s\) name a lane and the lane scan resolved NO emitted format/);
  });

  // 🔴 THE PACK-TARGET MAP IS DERIVED FROM tool.json, AND THESE CASES ARE WHAT
  // MAKE THAT A CLAIM RATHER THAN A COMMENT. Until 2026-09-05 the guard carried
  // the literal `['chromium', { platforms: ['chrome', 'edge'] }]`, a second copy
  // of tool.json's own `targets.chromium.stores` — and it was mutation-proven
  // BLIND to it on the real tree: renaming the mapping inside
  // extensions/Extension/Full_Screen_Shot/tool.json (`targets.chromium.stores`
  // to ["chrome"] with `storeMetadata.stores.edge.target` to "firefox") left
  // `node tooling/ci/assert-channel-register.mjs` at EXIT 0. Nothing anywhere in
  // either corpus compared the two declarations — measured, not assumed:
  // extensions/scripts/check-store-metadata.mjs holds every store's `target` to
  // the `targets` KEYS (:404) and every target to at least one store (:407), and
  // neither of those reads `targets.<t>.stores` at all.
  test('FAILS when tool.json`s two declarations of which stores a target reaches disagree — the forward half is wrong', () => {
    const { code, out } = run(tree({
      withExtension: true,
      extensionLane: true,
      toolJsonTargets: { chromium: { stores: ['chrome', 'edge'] } },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /declares `targets\.chromium\.stores` = \[chrome, edge\]/);
    assert.match(out, /the second copy is the one that drifts/);
  });

  test('FAILS when the REVERSE half is the one that moved — both directions, one message', () => {
    const { code, out } = run(tree({
      withExtension: true,
      extensionLane: true,
      toolJsonStores: {
        chrome: { target: 'chromium', dir: 'store/chrome', served: false },
        edge: { target: 'chromium', dir: 'store/edge', served: false },
      },
      toolJsonTargets: { chromium: { stores: ['chrome'] } },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /names \[chrome, edge\] as the rows built by target "chromium"/);
  });

  test('a target with NO forward `stores` key is not a finding — one target, one store, carried by the reverse declaration', () => {
    // `targets.firefox` in the real tool.json declares an `overlay` and no
    // `stores` array. Demanding the forward key everywhere would fail a tree that
    // is correct, so the comparison runs only where both halves are written.
    const { code, out } = run(tree({
      withExtension: true,
      extensionLane: true,
      toolJsonTargets: { chromium: { overlay: 'publish/manifest.chromium.json' } },
    }));
    assert.equal(code, 0, out);
  });

  // ⏱ 2026-09-14 — O-EXT-SURFACE-AXIS residue 2: the register's browser list is
  // held to the schema it names as its source. Green control first.
  test('surfaces.extension.platforms agreeing with tool.schema.json listings is green', () => {
    const { code, out } = run(tree({ withExtension: true, extensionLane: true }));
    assert.equal(code, 0, out);
  });

  test('FAILS when tool.schema.json gains a browser the register surface does not list', () => {
    const { code, out } = run(tree({ withExtension: true, extensionLane: true, extensionSchemaBrowsers: ['chrome', 'edge', 'firefox', 'safari'] }));
    assert.equal(code, 1, out);
    assert.match(out, /surfaces\."extension"\.platforms is \[chrome, edge, firefox\] and its declared source .* is \[chrome, edge, firefox, safari\]/);
  });

  test('FAILS when the register surface drops a browser the schema still declares', () => {
    const { code, out } = run(tree({
      withExtension: true,
      extensionLane: true,
      mutate: (r) => { r.surfaces.extension.platforms = ['chrome', 'edge']; r.channels.at(-1).platforms = ['chrome']; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /surfaces\."extension"\.platforms is \[chrome, edge\] and its declared source/);
  });

  test('FAILS when the schema the surface names as its source is gone', () => {
    const { code, out } = run(tree({ withExtension: true, extensionLane: true, extensionSchemaBrowsers: null }));
    assert.equal(code, 1, out);
    assert.match(out, /names its source as extensions\/scripts\/schema\/tool\.schema\.json .* and that file does not exist/);
  });

  test('the pack-target map is EMPTY when tool.json declares no targets — refused, never assumed', () => {
    // 🔴 THE DIRECT PROOF THAT NOTHING IS HARD-CODED. Delete `targets` from
    // tool.json and the guard has no mapping for `pack.mjs --target chromium` at
    // all, so the extension lane resolves no format and the run is COVERAGE LOST.
    // The old literal map could not produce this outcome on any input: it always
    // held chromium -> [chrome, edge] whatever tool.json said, which is exactly
    // the blindness this derivation removes.
    const { code, out } = run(tree({
      withExtension: true,
      extensionLane: true,
      toolJsonTargets: {},
    }));
    assert.equal(code, 2, out);
    assert.match(out, /extension store row\(s\) name a lane and the lane scan resolved NO emitted format/);
  });

  test('...and the SAME row is green once artifactBuild declares that format pack-built on the extension surface', () => {
    const { code, out } = run(tree({
      withExtension: true,
      extensionLane: true,
      mutate: (r) => { r.channels.at(-1).artifactFormats = ['.crx']; },
      breakArtifactBuild: (r) => {
        r.artifactBuild.formats['.crx'] = {
          surface: 'extension',
          packVerb: 'node extensions/scripts/pack.mjs fullshot --target chromium --out dist',
          packagedBy: 'NOT IMPLEMENTED ANYWHERE IN THIS REPOSITORY',
        };
      },
    }));
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A STORE WITH NO SUBMISSION API AT ALL — the `apps-gov-in` shape, 2026-09-07
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE LIMB THESE CASES REPLACE WAS AN ABSOLUTE: `submittable === true` on
// every app-surface store row. It held while every app store here published an
// API somebody could script, and it made `apps-gov-in` — a manual web form with
// no publishing API at all (research 09 §1.9) — undeclarable, because
// `submittable: true` then forces assert-publish-records.mjs to refuse COVERAGE
// LOST on the missing `submission` block.
//
// So `false` is admissible now, and it COSTS MORE THAN `true` DOES. The control
// comes first, and every case below is that control with one thing changed.
describe('assert-channel-register — a store channel that can never be scripted', () => {
  const noApi = (r) => {
    const row = r.channels[1];
    row.submittable = false;
    row.noSubmissionApi =
      'apps.gov.in publishes no submission API at all; the developer portal is a manual web workflow. Measured in research 09 §1.9.';
  };

  test('CONTROL — `submittable: false` with a written reason passes', () => {
    const { code, out } = run(tree({ mutate: noApi }));
    assert.equal(code, 0, out);
  });

  test('CONTROL — and the gap PRINTS on every run, in place of NO SUBMISSION PATH', () => {
    const { out } = run(tree({ mutate: noApi }));
    assert.match(out, /NO SUBMISSION API: channel "windows-store"/);
    assert.match(out, /manual web workflow/);
    assert.doesNotMatch(out, /NO SUBMISSION PATH: channel "windows-store"/);
  });

  // 🔴 THE ONE THAT KEEPS THIS FROM BEING A RELAXATION. [10]D-10 quantifies over
  // the flag, so a bare `false` would be the duty switched off with nothing for a
  // reviewer to disagree with.
  test('FAILS when `submittable: false` carries no `noSubmissionApi` reason', () => {
    const { code, out } = run(tree({
      mutate: (r) => { noApi(r); delete r.channels[1].noSubmissionApi; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /carries no written `noSubmissionApi` reason/);
  });

  test('FAILS when the reason is a word rather than a reason', () => {
    const { code, out } = run(tree({
      mutate: (r) => { noApi(r); r.channels[1].noSubmissionApi = 'no api'; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /carries no written `noSubmissionApi` reason/);
  });

  test('FAILS when the reason is whitespace — a string that satisfies typeof and says nothing', () => {
    const { code, out } = run(tree({
      mutate: (r) => { noApi(r); r.channels[1].noSubmissionApi = '                              '; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /carries no written `noSubmissionApi` reason/);
  });

  // The tie, in the direction that matters: a row may not keep a scripted path
  // AND declare itself unsubmittable. That is the shape in which `false` really
  // would be the duty disappearing.
  test('FAILS when a submission block is kept and the flag is flipped to false', () => {
    const { code, out } = run(tree({
      withSubmission: true,
      mutate: (r) => { noApi(r); },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /declares a `submission` block and is not `submittable`/);
  });

  // And the old reading is not silently restored: a `true` with no block still
  // PRINTS rather than failing, because BUILDING a path is owner-gated.
  test('a submittable store row with no block still PRINTS, unchanged', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /NO SUBMISSION PATH: channel "windows-store"/);
    assert.doesNotMatch(out, /NO SUBMISSION API/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ ADDED 2026-09-24 — `deferral.ruledOutBy` (O-WINDOWS-RELEASE-SHIPS-LOOSE-RUNNER,
// red control R6). release-manifest.mjs `storeOnlyFormats` reads the field to decide
// what a GitHub Release may carry, so the two shapes that would make that reading
// unsafe are refused where the register is owned: a SERVED row that is ruled out,
// and an id that is not a constraint id. Both exit 0 on the guard as it stood.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — a ruled-out channel names its constraint and is never served', () => {
  test('CONTROL — a deferred row ruled out by a constraint id passes, and PRINTS which constraint', () => {
    const { code, out } = run(tree({
      mutate: (r) => { r.channels[1].deferral = { reason: 'forbidden', alsoBlockedBy: null, ruledOutBy: 'C-WINDOWS-STORE-ONLY' }; },
    }));
    assert.equal(code, 0, out);
    assert.match(out, /RULED OUT: channel "windows-store" is forbidden by C-WINDOWS-STORE-ONLY/);
  });

  test('R6 — FAILS when a SERVED row carries `ruledOutBy`', () => {
    const { code, out } = run(tree({
      mutate: (r) => { r.channels[0].deferral = { reason: 'forbidden', alsoBlockedBy: null, ruledOutBy: 'C-WINDOWS-STORE-ONLY' }; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /channel "web" is SERVED and carries `deferral\.ruledOutBy` "C-WINDOWS-STORE-ONLY"/);
  });

  test('R6 — FAILS when `ruledOutBy` is not a constraint id', () => {
    const { code, out } = run(tree({
      mutate: (r) => { r.channels[1].deferral = { reason: 'forbidden', alsoBlockedBy: null, ruledOutBy: 'windows store only' }; },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /channel "windows-store" has `deferral\.ruledOutBy` "windows store only", which is not a constraint id/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ ADDED 2026-09-22 — limb 6b-iv, PAIRING (P1-2 consumer C6).
// ⏱ 2026-09-23 — RE-CUT onto the census. Since 6b-ii fails a PLATFORM mismatch
// (an apk stamped `ios-appstore`), the ios-appstore-in-the-Android-job example
// this block was written around is 6b-ii's failure now, not this limb's. What
// only pairing can see is a valid id on the RIGHT platform in the WRONG lane,
// and that is what these cases build.
//
// 6b grades a stamp for MEMBERSHIP, 6b-ii for PLATFORM. The site is paired with
// the row: (a) the row's `lane` is this workflow#job, (b) the row's
// `submission.workflow` is this workflow, or (c) the segment invokes the row's
// `submission.script`. Anything else is declared in the guard's
// CHANNEL_STAMP_EXEMPT with a `why`, and an excuse that outlives its stamp fails
// — that half is graded against the REAL tree only, because the table names
// real workflow paths and a fixture has none of them.
//
// Red control on a copy of the real tree, 2026-09-23 (int/base-w34): re-pointing
// the android-play row's `lane.job` from `linux_web_android` to `apple` — the
// stamps stay put and the ROW drifts — is exit 0 on the guard as shipped and
// exit 1 after (both android-play stamps fail as wrong-lane, and the apple job
// fails the other direction: it stamps "macos-appstore", "ios-appstore" — never
// "android-play").
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-register — a stamped channel belongs to the job that stamps it', () => {
  test('PASSES when the only stamp stands in its own row lane', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /channel stamp\(s\) across .* paired with the row's lane, submission workflow or submission script/);
  });

  test('FAILS on a valid id, on the right platform, stamped by a job that neither builds nor ships it', () => {
    // The build workflow's windows job compiles a WEB bundle stamped `web`. The
    // platform matches (6b-ii is satisfied) and the id resolves (6b is), but the
    // web row names deploy-web as its lane: a real id, a real job, and the
    // register says they are not each other's.
    const { code, out } = run(
      tree({ windowsRun: 'flutter build web --release --dart-define=RELEASE_CHANNEL=web' }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /\(job "windows"\) stamps channel "web", and its lane is .*#deploy-web/);
    assert.match(out, /a valid id in the wrong lane/);
    assert.match(out, /CHANNEL_STAMP_EXEMPT/);
    assert.doesNotMatch(out, /does not include "web"/);
  });

  test('PRINTS, never fails, for a row that declares no lane when the census places the build on its platform', () => {
    // build-platforms.yml's six-platform proof stamps `linux-appimage` and
    // `apps-gov-in`, and neither row names a lane — nothing has claimed those
    // artifacts yet. There is no wrong job to name, so the register, not the
    // workflow, is what has to change; failing here would demand an exemption
    // for a fact the ROW should carry.
    const { code, out } = run(
      tree({ windowsRun: 'flutter build windows --release --dart-define=RELEASE_CHANNEL=windows-store' }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /UNANCHORED STAMP: .*stamps "windows-store", whose row declares no lane and no submission/);
    assert.match(out, /The census has placed the build on that row's platform/);
  });

  test('a platform mismatch is 6b-ii\'s failure ALONE — pairing does not report it a second time', () => {
    // A job that compiles macOS did not build the Windows Store artifact it
    // stamps. 6b-ii fails that; this limb grades only the census's `graded`
    // set, so the defect is one failing line, not two.
    const { code, out } = run(
      tree({ windowsRun: 'flutter build macos --release --dart-define=RELEASE_CHANNEL=windows-store' }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /stamps RELEASE_CHANNEL=windows-store, whose `platforms` is \[windows\] and does not include "macos"/);
    assert.doesNotMatch(out, /a valid id in the wrong lane/);
    assert.doesNotMatch(out, /UNANCHORED STAMP/);
  });

  test('FAILS in the other direction: the row lane job stamps everything but its own id', () => {
    // The register says web is built by deploy-web; deploy-web's only STAMP is
    // windows-store (a platform-valid, lane-less row, so the site itself
    // prints). The site-side check cannot see this — the stamps stay put and
    // the ROW drifts — so the lane side is asserted separately. The web build
    // stays in the job, unstamped: without a web artifact at all, section 3b's
    // COVERAGE LOST (exit 2) fires before this limb is reached.
    const { code, out } = run(
      tree({
        releaseChannel: null,
        laneExtraRun: ['flutter build windows --release --dart-define=RELEASE_CHANNEL=windows-store'],
      }),
    );
    assert.equal(code, 1, out);
    assert.doesNotMatch(out, /COVERAGE LOST/);
    assert.match(out, /gives "web" \(surface app\) the lane .*#deploy-web, and that job stamps "windows-store" — never "web"/);
  });

  test('PAIRS a --channel argument through the row own submission script, wherever it runs', () => {
    // Clause (c): the real shape is ci.yml's dry-run leg invoking
    // submit-appstore.mjs --channel ios-appstore outside the submission workflow.
    const { code, out } = run(
      tree({ withSubmission: true, laneExtraRun: [`node ${SUBMIT_SCRIPT} --channel windows-store --dry-run`] }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /paired with the row's lane, submission workflow or submission script/);
  });

  test('FAILS on a --channel argument that names no register row — the form 6b never graded', () => {
    const { code, out } = run(
      tree({ withSubmission: true, laneExtraRun: [`node ${SUBMIT_SCRIPT} --channel windows-stroe --dry-run`] }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /passes --channel windows-stroe/);
    assert.match(out, /submits nothing, or submits to the wrong listing/);
  });

  test('a ${{ }} expression is not a literal stamp and is not paired against', () => {
    // GitHub substitutes it at run time, so there is no id here to pair or to
    // hold to the register. A limb that read the text would report the
    // expression itself as an unknown channel on every dispatchable workflow.
    const { code, out } = run(
      tree({ withSubmission: true, laneExtraRun: [`node ${SUBMIT_SCRIPT} --channel \${{ inputs.channel }}`] }),
    );
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /inputs\.channel/);
  });

  test('a --channel behind a shell comment is prose, not an argument', () => {
    // Inside a folded `run: >` block a `#` swallows the rest of the command, so
    // the argument after it never reaches the script — the same cut
    // workflow-scan's definesIn makes for a define.
    const { code, out } = run(
      tree({ withSubmission: true, laneExtraRun: [`echo dry-run # node ${SUBMIT_SCRIPT} --channel windows-stroe`] }),
    );
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /windows-stroe/);
  });
});

// ⏱ 2026-09-24 — grader-is-run (O-EXTENSIONS-CI-REQUIRED-GATES-NOTHING, EXT-2 limb a).
// Every `storeMetadataGradedBy` must be run by a job ci-gate waits on: its needs, a
// local call one level in, the callee's ci-required needs. Each case hands in a ci.yml
// whose `app-brick` keeps the fixture register's `releaseBuildsNeverShipped` entry true.
describe('assert-channel-register — grader-is-run: every storeMetadataGradedBy runs inside ci-gate', () => {
  const EXT_GRADER = 'extensions/scripts/check-store-metadata.mjs';
  const CALLEE = '.github/workflows/lane-ci.yml';
  const brick = ['  app-brick:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: flutter build web --pwa-strategy=none'];
  const ciYml = (jobs, needs) =>
    ['name: CI', 'on:', '  push:', 'jobs:', ...brick, ...jobs,
      '  ci-gate:', '    runs-on: ubuntu-24.04', `    needs: [${['app-brick', ...needs].join(', ')}]`, '    if: always()', '    steps:', '      - run: echo gate', ''].join(NL);
  const calleeYml = (gatesRun) =>
    ['name: Lane CI', 'on:', '  workflow_call:', 'defaults:', '  run:', '    working-directory: extensions', 'jobs:',
      '  gates:', '    runs-on: ubuntu-24.04', '    steps:', `      - run: ${gatesRun}`,
      '  ci-required:', '    runs-on: ubuntu-24.04', '    needs: [gates]', '    if: always()', '    steps:', '      - run: echo aggregate', ''].join(NL);
  const callJob = (callee) => ['  extensions:', `    uses: ./${callee}`];
  const extGraded = (r) => { r.surfaces.app.storeMetadataGradedBy = EXT_GRADER; };

  test('PASSES when a job ci-gate needs runs the grader, and prints the walk', () => {
    const storeJob = ['  guards-store:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: node tooling/ci/assert-store-metadata.mjs'];
    const { code, out } = run(tree({ gate: false, extraFiles: { [GATE_CI]: ciYml(storeJob, ['guards-store']) } }));
    assert.equal(code, 0, out);
    assert.match(out, /grader-is-run — 1 storeMetadataGradedBy grader\(s\) run by a job ci-gate waits on/);
    assert.match(out, /surfaces\."app" → tooling\/ci\/assert-store-metadata\.mjs, run by \.github\/workflows\/ci\.yml job "guards-store" \(ci-gate → guards-store\)/);
  });

  test('PASSES when the grader runs in a callee job inside the callee\'s ci-required needs, through the call', () => {
    const { code, out } = run(tree({
      gate: false,
      mutate: extGraded,
      extraFiles: {
        [EXT_GRADER]: '// the extension listing grader\n',
        [GATE_CI]: ciYml(callJob(CALLEE), ['extensions']),
        [CALLEE]: calleeYml('node scripts/check-store-metadata.mjs fullshot'),
      },
    }));
    assert.equal(code, 0, out);
    assert.match(out, /surfaces\."app" → extensions\/scripts\/check-store-metadata\.mjs, run by \.github\/workflows\/lane-ci\.yml job "gates" \(ci-gate → extensions → \.github\/workflows\/lane-ci\.yml ci-required → gates\)/);
  });

  test('FAILS when the grader runs only in a job outside ci-gate\'s closure — the release job\'s shape', () => {
    const release = ['name: Ext', 'on:', '  push:', '    tags: [x-v1]', 'defaults:', '  run:', '    working-directory: extensions', 'jobs:',
      '  release:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: node scripts/check-store-metadata.mjs fullshot', ''].join(NL);
    const { code, out } = run(tree({
      gate: false,
      mutate: extGraded,
      extraFiles: {
        [EXT_GRADER]: '// the extension listing grader\n',
        [GATE_CI]: ciYml(callJob(CALLEE), ['extensions']),
        [CALLEE]: calleeYml('echo no grader here'),
        '.github/workflows/ext.yml': release,
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /surfaces\."app" is graded by extensions\/scripts\/check-store-metadata\.mjs, and no job ci-gate waits on runs it/);
    assert.match(out, /It is invoked only by \.github\/workflows\/ext\.yml job "release", outside that closure/);
  });

  test('COVERAGE LOST (exit 2) when a need of ci-gate calls a workflow that is not in the tree', () => {
    const { code, out } = run(tree({
      gate: false,
      mutate: extGraded,
      extraFiles: {
        [EXT_GRADER]: '// the extension listing grader\n',
        [GATE_CI]: ciYml(callJob('.github/workflows/gone.yml'), ['extensions']),
      },
    }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — \.github\/workflows\/ci\.yml job `extensions` is a need of ci-gate and calls \.github\/workflows\/gone\.yml, which the grader-is-run limb cannot follow \(missing\)/);
  });

  // ⏱ 2026-09-24 (ADR 095): a lane callee's aggregate is the job that runs
  // tooling/ci/lane-verdict.mjs, not a job named ci-required.
  const laneCalleeYml = (verdictRun) =>
    ['name: Lane workers', 'on:', '  workflow_call:', 'defaults:', '  run:', '    working-directory: extensions', 'jobs:',
      '  work:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: node scripts/check-store-metadata.mjs fullshot',
      '  lane-verdict:', '    runs-on: ubuntu-24.04', '    needs: [work]', '    if: always()', '    steps:', `      - run: ${verdictRun}`, ''].join(NL);

  test('PASSES when the grader runs in a lane callee job that the callee\'s lane-verdict job needs', () => {
    const { code, out } = run(tree({
      gate: false,
      mutate: extGraded,
      extraFiles: {
        [EXT_GRADER]: '// the extension listing grader\n',
        [GATE_CI]: ciYml(callJob(CALLEE), ['extensions']),
        [CALLEE]: laneCalleeYml('node tooling/ci/lane-verdict.mjs'),
      },
    }));
    assert.equal(code, 0, out);
    assert.match(out, /run by \.github\/workflows\/lane-ci\.yml job "work" \(ci-gate → extensions → \.github\/workflows\/lane-ci\.yml lane-verdict → work\)/);
  });

  test('COVERAGE LOST (exit 2) when a called workflow has neither ci-required nor a job running lane-verdict.mjs', () => {
    const { code, out } = run(tree({
      gate: false,
      mutate: extGraded,
      extraFiles: {
        [EXT_GRADER]: '// the extension listing grader\n',
        [GATE_CI]: ciYml(callJob(CALLEE), ['extensions']),
        [CALLEE]: laneCalleeYml('echo no verdict here'),
      },
    }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — \.github\/workflows\/lane-ci\.yml, called by ci-gate's need `extensions`, has no verdict job: neither `ci-required` nor a job that runs tooling\/ci\/lane-verdict\.mjs/);
  });
});
