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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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
const laneWorkflow = ({ laneBuilds = true, releaseChannel = 'web', laneSecrets = [] } = {}) => `name: Deploy web
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
${laneSecrets.map((n) => `      - run: echo "\${{ secrets.${n} }}"`).join('\n')}${laneSecrets.length ? '\n' : ''}      - run: >
          ${laneBuilds ? 'flutter build web --release' : 'echo deploy'}${releaseChannel === null ? '' : `
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
  platforms: ['web'],
  kind: 'web',
  served: true,
  submittable: false,
  artifactFormats: ['static-bundle'],
  signing: {
    keyKind: 'none',
    identity: null,
    custody: 'the web channel signs nothing',
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
  platforms: ['windows'],
  kind: 'store',
  served: false,
  submittable: true,
  artifactFormats: ['.msix'],
  signing: {
    keyKind: 'none',
    identity: null,
    custody: 'the Store re-signs the MSIX',
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
    invoked ? `      - run: node ${RECIPE_SCRIPT} --app subly` : `      # - run: node ${RECIPE_SCRIPT} --app subly`,
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

const androidPlay = () => ({
  id: ANDROID_ID,
  name: 'Google Play',
  platforms: ['android'],
  kind: 'store',
  served: false,
  submittable: true,
  artifactFormats: ['.aab'],
  signing: {
    keyKind: 'upload-key',
    identity: 'release-keystore/release.keystore',
    custody: 'recorded in the private SSoT',
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
function tree({
  mutate = null,
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
  // ── section 9 ──────────────────────────────────────────────────────────────
  // `withAndroid` adds the android-play row (which carries a `gradleContract`)
  // AND the build file it points at. Both off by default.
  withAndroid = false,
  gradle = {},
  omitGradleFile = false,
  adrLocked = true,
  adrOnDisk = true,
  // `knowledge/` is gitignored, so a CI checkout has no harness at all. The ADR
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
  // Extra files written into the fixture root, for cases that need a real ADR
  // on disk beside the harness marker.
  extraFiles = {},
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
    keyKinds: {
      none: 'the channel signs for us — nothing of ours can be lost',
      'upload-key': 'we sign the upload; the store holds the real app signing key',
      'app-signing-key': "we hold the key end users' installs are bound to",
      'distribution-certificate': 'an Apple distribution certificate + provisioning profile',
      'code-signing-certificate': 'a CA-issued certificate chaining to a trusted root',
      'own-signing-key': 'our own detached signature, no gatekeeper verifying it',
    },
    channels: [servedWeb(), deferredWindowsStore()],
    disqualified: [
      {
        id: 'flathub',
        name: 'Flathub',
        platforms: ['linux'],
        adr: 'knowledge/decisions/015-linux.md',
        date: '2026-07-25',
        ownerQueue: 'A-5',
        reason: ['bans AI-assisted code'],
      },
    ],
    nonChannelSigningIdentities: [],
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
  if (mutate) mutate(register);

  // 🔴 DERIVED FROM THE REGISTER AFTER THE MUTATION, never typed. A case that
  // renames a secret HERE would otherwise leave the lane naming the old one, and
  // section 8 would fail alongside section 9 — two messages for one mutation, and
  // a red result nobody can attribute. Deriving keeps section 8 silent throughout.
  const androidNames = withAndroid
    ? (register.channels.find((c) => c.id === ANDROID_ID)?.signing?.ciSecrets?.names ?? []).filter((n) => typeof n === 'string')
    : [];

  write('sites/_shared/_data/apps.json', JSON.stringify([{ slug: 'subly', platforms, status: 'live' }]));
  write('tooling/versions.json', JSON.stringify({ flutter: '3.44.8', wrangler: '4.114.0', java: '17' }));
  write(LANE_WORKFLOW, laneWorkflow({ laneBuilds, releaseChannel, laneSecrets: [...laneSecrets, ...androidNames] }));
  if (withAndroid && !omitGradleFile) write(GRADLE_TEMPLATE.split('{app}').join('subly'), gradleFile(gradle));
  write(BUILD_WORKFLOW, buildWorkflow({ needs, verdicts, verdictStyle, exitOne, extraJob, windowsRun }));
  if (harnessPresent) {
    // The harness root exists even when the cited ADR does not — that is the
    // distinction the guard turns on, and the case a blanket existsSync() skip
    // would have thrown away.
    write('knowledge/decisions/README.md', 'the harness is checked out\n');
    if (adrOnDisk) {
      write('knowledge/decisions/015-linux.md', adrLocked ? '# 015\n**Status:** LOCKED 2026-07-25\n' : '# 015\n**Status:** proposed\n');
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
  for (const [rel, body] of Object.entries(extraFiles)) write(rel, body);
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
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /does not exist/);
  });

  test('FAILS COVERAGE LOST when the register declares zero channels', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels = []; } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO channels/);
  });

  test('FAILS COVERAGE LOST when no channel is served', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels.forEach((c) => { c.served = false; }); } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NONE is served/);
  });

  test('FAILS COVERAGE LOST when an app claims an empty platform set', () => {
    const { code, out } = run(tree({ platforms: [] }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO platform claims/);
  });

  test('FAILS COVERAGE LOST when the register is not valid JSON', () => {
    const { code, out } = run(tree({ registerRaw: '{ "channels": [ ' }));
    assert.equal(code, 1, out);
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
    const { code, out } = run(servedMutation((c) => { c.deploymentEnvironment = 'subly-web'; }));
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

  test('FAILS when a channel names a platform outside Flutter\'s vocabulary', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].platforms = ['tizen']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /no apps\.json claim can ever resolve to it/);
  });

  test('FAILS when two channels share an id', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.channels[1].id = 'web'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /duplicate id/);
  });

  // ── the ADR check is MODE-AWARE, and both modes are tested ────────────────
  // Found the hard way: this guard's first CI run failed on run 30609219162
  // because `knowledge/` is gitignored, so a correct check reported a fault that
  // did not exist. The fix must not lose the case below, which is the one that
  // matters — harness present, ADR gone.
  test('FAILS when the harness IS checked out and the cited ADR is not on disk', () => {
    const { code, out } = run(tree({ adrOnDisk: false }));
    assert.equal(code, 1, out);
    assert.match(out, /which is not on disk although `knowledge\/` is/);
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
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no `keyKinds` vocabulary/);
  });

  test('FAILS COVERAGE LOST when the keyKinds dictionary is emptied', () => {
    const { code, out } = run(tree({ mutate: (r) => { r.keyKinds = {}; } }));
    assert.equal(code, 1, out);
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
    const { code, out } = run(tree({ windowsRun: 'flutter build windows --release' }));
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
        windowsRun: 'flutter build apk --release',
        mutate: (r) => { r.channels[1].platforms = ['android']; r.channels[1].artifactFormats = ['.aab']; },
      }),
    );
    assert.equal(withGap.code, 0, withGap.out);
    assert.match(withGap.out, /FORMAT GAP \(deferred\)[\s\S]*builds "\.apk" for "android"/);

    const closed = run(
      tree({
        windowsRun: 'flutter build apk --release\n      - run: flutter build appbundle --release',
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
      '            apps/subly/build/app/outputs/flutter-apk/*.apk',
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
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT ONE yielded a readable artifact/);
  });

  test('PRINTS an unmapped `flutter build` target rather than comparing against nothing', () => {
    const { code, out } = run(tree({ windowsRun: 'flutter build fuchsia --release' }));
    assert.equal(code, 0, out);
    assert.match(out, /UNMAPPED BUILD TARGET\(S\): "fuchsia"/);
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
    const { code, out } = run(tree({ releaseChannel: 'windows-store' }));
    assert.equal(code, 0, out);
  });

  test('no stamp anywhere PRINTS the gap rather than failing', () => {
    const { code, out } = run(tree({ releaseChannel: null }));
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
    assert.equal(code, 1);
    assert.match(out, /no `kind: "store"` row/);
  });

  test('a non-store row is not asked for an accountStatus', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /channel "web".*accountStatus/);
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
        adr: 'knowledge/decisions/022-pack.md',
        restoreDrill: { date: null, required: true, note: 'never drilled' },
        ...over,
      },
    ];
  };
  const withAdrFile = (root, locked = true) => ({
    'knowledge/decisions/022-pack.md': locked ? '# 022\n**Status:** LOCKED 2026-07-27\n' : '# 022\n**Status:** proposed\n',
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
    assert.match(out, /which is not on disk although `knowledge\/` is/);
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
    assert.equal(code, 1, out);
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
    assert.equal(code, 1, out);
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
// apps/subly/android/app/build.gradle.kts, renaming one in
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
    assert.equal(code, 1, out);
    assert.match(out, /FAIL COVERAGE LOST/);
    assert.match(out, /declares no `val releaseSigningEnv = mapOf\(…\)` outside its comments/);
  });

  test('COVERAGE LOST when the map declares no pairs at all', () => {
    const { code, out } = run(tree({ withAndroid: true, gradle: { pairs: [] } }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL COVERAGE LOST/);
    assert.match(out, /declares no "key" to "VARIABLE" pairs/);
  });

  // ── the scan must reach what it thinks ────────────────────────────────────
  test('COVERAGE LOST when `declaredIn` resolves to no file on disk', () => {
    const { code, out } = run(tree({ withAndroid: true, omitGradleFile: true }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL COVERAGE LOST/);
    assert.match(out, /`declaredIn` template reached 0 file\(s\) on disk; REQUIRED_COVERAGE is 1/);
    assert.match(out, /Tried: apps\/subly\/android\/app\/build\.gradle\.kts/);
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
    assert.equal(code, 1, out);
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
          contract(r).declaredIn = 'apps/subly/android/app/build.gradle.kts';
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /must be a path TEMPLATE containing `\{app\}`/);
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
