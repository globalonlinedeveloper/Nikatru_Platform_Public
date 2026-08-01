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
 *  than a quiet pass. */
const laneWorkflow = ({ laneBuilds = true } = {}) => `name: Deploy web
# The aggregating job all_platforms and the job ghost-job are named here in a
# comment only. Nothing below declares them.
on:
  push:
jobs:
  deploy-web:
    name: Build & deploy
    runs-on: ubuntu-24.04
    steps:
      - run: ${laneBuilds ? 'flutter build web --release' : 'echo deploy'}
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
  }
  if (mutate) mutate(register);

  write('sites/_shared/_data/apps.json', JSON.stringify([{ slug: 'subly', platforms, status: 'live' }]));
  write('tooling/versions.json', JSON.stringify({ flutter: '3.44.8', wrangler: '4.114.0', java: '17' }));
  write(LANE_WORKFLOW, laneWorkflow({ laneBuilds }));
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

  test('PASSES a served channel whose key IS drilled, with a date', () => {
    const { code, out } = run(
      servedMutation((c) => {
        c.signing.keyKind = 'upload-key';
        c.signing.identity = 'release-keystore/upload.keystore';
        c.signing.restoreDrill = { date: '2026-07-31', required: true, note: 'drilled' };
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
