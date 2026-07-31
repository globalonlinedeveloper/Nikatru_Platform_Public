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
 *  lane against its own documentation. This repo has shipped that defect twice. */
const laneWorkflow = `name: Deploy web
# The aggregating job all_platforms and the job ghost-job are named here in a
# comment only. Nothing below declares them.
on:
  push:
jobs:
  deploy-web:
    name: Build & deploy
    runs-on: ubuntu-24.04
    steps:
      - run: echo deploy
`;

/** A build workflow shaped like the real one: three platform jobs plus an
 *  aggregator that needs all three and tests both verdicts. */
function buildWorkflow({ needs = ['linux', 'windows', 'apple'], verdicts = ['failure', 'cancelled'] } = {}) {
  const tests = verdicts
    .map((v) => `[ "\${{ contains(needs.*.result, '${v}') }}" = "true" ]`)
    .join(' || ');
  return [
    'name: Build',
    'on:',
    '  workflow_dispatch:',
    'jobs:',
    '  linux:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - run: echo linux',
    '  windows:',
    '    runs-on: windows-2025',
    '    steps:',
    '      - run: echo windows',
    '  apple:',
    '    runs-on: macos-26',
    '    steps:',
    '      - run: echo apple',
    '  all_platforms:',
    '    runs-on: ubuntu-24.04',
    `    needs: [${needs.join(', ')}]`,
    '    if: always()',
    '    steps:',
    '      - run: |',
    `          if ${tests}; then`,
    '            exit 1',
    '          fi',
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
  verdicts = ['failure', 'cancelled'],
  adrLocked = true,
  adrOnDisk = true,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    aggregatingJob: { workflow: BUILD_WORKFLOW, job: 'all_platforms' },
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
  if (mutate) mutate(register);

  write('sites/_shared/_data/apps.json', JSON.stringify([{ slug: 'subly', platforms, status: 'live' }]));
  write('tooling/versions.json', JSON.stringify({ flutter: '3.44.8', wrangler: '4.114.0', java: '17' }));
  write(LANE_WORKFLOW, laneWorkflow);
  write(BUILD_WORKFLOW, buildWorkflow({ needs, verdicts }));
  if (adrOnDisk) {
    write('knowledge/decisions/015-linux.md', adrLocked ? '# 015\n**Status:** LOCKED 2026-07-25\n' : '# 015\n**Status:** proposed\n');
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
    assert.match(out, /SERVED but no app/);
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
        c.signing.restoreDrill = { date: '2026-07-31', required: true, note: 'drilled' };
      }),
    );
    assert.equal(code, 0, out);
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
    assert.match(out, /never tests for 'cancelled'/);
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

  test('FAILS when a disqualified channel cites an ADR that is not on disk', () => {
    const { code, out } = run(tree({ adrOnDisk: false }));
    assert.equal(code, 1, out);
    assert.match(out, /which is not on disk/);
  });

  test('FAILS when a disqualified channel cites an ADR that is not LOCKED', () => {
    const { code, out } = run(tree({ adrLocked: false }));
    assert.equal(code, 1, out);
    assert.match(out, /does not record itself as LOCKED/);
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
