// ─────────────────────────────────────────────────────────────────────────────
// redeploy-stranded.test.mjs — a deploy lane stranded by a red ci-gate is
// re-entered once ci-gate is green again; a lane that failed for any OTHER
// reason is never touched.
//
// 🔴 THE INSTANCE, 2026-09-22 (O-CI-GATE-CASCADE-STRANDS-THE-DEPLOY-LANES).
// `Deploy web` #426 and `Deploy workers` #168 failed on "Require ci-gate to have
// passed for this commit" at 2c4540fa. CI went green only at 35147514, a
// sitemap-only repair no lane's `push: paths:` matches, so nothing re-entered
// either lane. The TONIGHT case below is that instance as a fixture: it must
// DISPATCH both lanes, because a same-SHA re-run could never recover it —
// ci-gate at 2c4540fa stays red for ever.
//
// ⚠️ WHAT THE RED CONTROLS ARE FOR. A recovery that re-deploys over a GENUINE
// deploy failure, or re-runs a stale run behind a newer deploy, is worse than
// none — the second rolls production back. Each refusal is asserted twice: the
// pure `decide` returns `none`, AND the CLI over the same fixture leaves the
// fixture log ABSENT. The exit code alone is not evidence; a version that
// printed the refusal and then dispatched anyway would pass an exit-code check.
//
// ⚠️ THE LANE SET IS DERIVED, SO IT IS PINNED FROM BOTH SIDES: against the real
// tree (exactly build-platforms.yml since 2026-09-25, below), and
// by mutation — a trigger list missing a lane, and a new gated lane nobody added
// to the trigger, must each make the tool refuse to run (exit 2). Each of the
// four limbs (L1–L4 in the tool's header) has a mutation that breaks it ALONE.
//
// 🔴 THE SECOND INSTANCE, 2026-09-23 (O-REDEPLOY-STRANDED-MISSES-THE-BUILD-LANE).
// Build apps #102 (run 35800063831, the Worker's 00:00Z dispatch at c1cdb241)
// failed on the gate step, and "all-platforms" — an `if: always()` aggregate
// behind the gate — failed with it. The REPLAY case below is that run: it must
// DISPATCH, and a lane whose only failure is such a consequence job must not.
//
// ⏱ 2026-09-25 [ADR 095 §4]: deploy-web.yml and deploy-workers.yml are no
// longer lanes. They are `on: workflow_call` only, run by ci.yml after ci-gate in
// the same run, so the real tree derives build-platforms.yml alone. The two
// instances above stay as fixtures: `legacyRoot()` writes the two deploy lanes
// back (push on main, a bare dispatch, the named gate step) onto a copy of the
// real tree, and every CLI case over them runs with `--root` on that copy.
//
// NOTHING HERE TOUCHES THE NETWORK. Every CLI case runs the fixture transport,
// which has no fetch in it; the one live-shaped case withholds the credential.
//
// Run:  node --test tooling/ci/test/redeploy-stranded.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decide,
  deployLanes,
  gateCheckName,
  newestRun,
  triggerProblem,
  rerunArgv,
  RECOVERY_WORKFLOW,
  CHANNEL_REGISTER,
} from '../../ops/redeploy-stranded.mjs';
import { parseWorkflow, workflowEvents } from '../workflow-scan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'redeploy-stranded.mjs');
const GATE_STEP = 'Require ci-gate to have passed for this commit';

const X = '2c4540fa00000000000000000000000000000000'; // the stranded merge
const Y = '3514751400000000000000000000000000000000'; // the sitemap-only repair, CI green

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'redeploy-stranded-')); temps.push(d); return d; };

const GREEN = { status: 'completed', conclusion: 'success' };
const run = (o) => ({ event: 'push', status: 'completed', conclusion: 'failure', run_attempt: 1, ...o });
const gateJob = (name) => ({ name, conclusion: 'failure', steps: [
  { name: 'Set up job', conclusion: 'success' },
  { name: GATE_STEP, conclusion: 'failure' },
  { name: 'Deploy to Cloudflare Pages', conclusion: 'skipped' },
] });
const realJob = (name) => ({ name, conclusion: 'failure', steps: [
  { name: GATE_STEP, conclusion: 'success' },
  { name: 'Deploy to Cloudflare Pages', conclusion: 'failure' },
] });
const skippedJob = (name) => ({ name, conclusion: 'skipped', steps: [] });
// build-platforms' `all_platforms`: `if: always()`, needs the gate, fails on its
// own check whenever anything upstream did not succeed.
const aggJob = (name) => ({ name, conclusion: 'failure', steps: [
  { name: 'Set up job', conclusion: 'success' },
  { name: 'Require every platform green', conclusion: 'failure' },
] });
const LANE = { file: 'deploy-web.yml', gateStep: GATE_STEP };
const BP = { file: 'build-platforms.yml', gateStep: GATE_STEP, consequenceJobs: ['all-platforms'] };
// Build apps #102 as the jobs API reported it: the gate job and the aggregate
// failed, every other job skipped.
const bpStranded = () => [
  gateJob('Require ci-gate to have passed'),
  skippedJob('Derive the app set from the pub workspace'),
  skippedJob('Linux + Web + Android'),
  skippedJob('Windows'),
  skippedJob('macOS + iOS'),
  skippedJob('Durable release artifacts'),
  aggJob('all-platforms'),
];

// ═══════════════════════════════════════════════════════════════════════════
describe('decide — the two ways back in', () => {
  test('SAME-SHA: gate-step failure at head, ci-gate at head green → re-run that run', () => {
    const v = decide({ lane: LANE, head: X, gate: GREEN,
      runs: [run({ id: 426, run_number: 426, head_sha: X }), run({ id: 425, run_number: 425, head_sha: 'a'.repeat(40), conclusion: 'success' })],
      jobs: [gateJob('Build & deploy web (subscriptiontracker)')] });
    assert.equal(v.action, 'rerun', v.why);
    assert.equal(v.runId, 426);
  });

  test('TONIGHT: gate-step failure at an ANCESTOR, head green and ahead → dispatch', () => {
    const v = decide({ lane: LANE, head: Y, gate: GREEN,
      runs: [run({ id: 426, run_number: 426, head_sha: X })],
      jobs: [gateJob('Build & deploy web (subscriptiontracker)')], relation: 'ahead' });
    assert.equal(v.action, 'dispatch', v.why);
  });

  test('deploy-workers shape: the gate job failed, the jobs behind it skipped → still a strand', () => {
    const v = decide({ lane: { file: 'deploy-workers.yml', gateStep: GATE_STEP }, head: Y, gate: GREEN,
      runs: [run({ id: 168, run_number: 168, head_sha: X })],
      jobs: [gateJob('detect'), skippedJob('deploy-api'), skippedJob('deploy-sync')], relation: 'ahead' });
    assert.equal(v.action, 'dispatch', v.why);
  });

  test('the re-run reuses safe-rerun.mjs with --failed, never a whole-run re-run', () => {
    const argv = rerunArgv(426);
    assert.match(argv[0].replace(/\\/g, '/'), /tooling\/ops\/safe-rerun\.mjs$/);
    assert.deepEqual(argv.slice(1), ['426', '--failed']);
  });
});

describe('decide — a CADENCE lane (Build apps) and its consequence job', () => {
  test('REPLAY of 35800063831: the Worker dispatch failed the gate, all-platforms failed with it, head ahead and green → dispatch', () => {
    const v = decide({ lane: BP, head: Y, gate: GREEN,
      runs: [run({ id: 35800063831, run_number: 102, head_sha: X, event: 'workflow_dispatch' }),
        run({ id: 35700000000, run_number: 101, head_sha: 'c'.repeat(40), event: 'workflow_dispatch', conclusion: 'success' })],
      jobs: bpStranded(), relation: 'ahead' });
    assert.equal(v.action, 'dispatch', v.why);
  });

  test('a SCHEDULED run stranded at head, attempt 1 → re-run it (a re-run keeps event=schedule)', () => {
    const v = decide({ lane: BP, head: Y, gate: GREEN,
      runs: [run({ id: 1030, run_number: 103, head_sha: Y, event: 'schedule' })], jobs: bpStranded() });
    assert.equal(v.action, 'rerun', v.why);
    assert.equal(v.runId, 1030);
  });

  test('newestRun reads a later schedule run over an older failed dispatch', () => {
    const n = newestRun([
      run({ id: 1020, run_number: 102, head_sha: X, event: 'workflow_dispatch' }),
      run({ id: 1030, run_number: 103, head_sha: Y, event: 'schedule', conclusion: 'success' }),
    ]);
    assert.equal(n?.id, 1030);
  });
});

describe('decide — RED CONTROLS: nothing is re-entered', () => {
  const base = { lane: LANE, head: Y, gate: GREEN, runs: [run({ id: 426, run_number: 426, head_sha: X })], relation: 'ahead' };
  // One `test(` per case, never a loop: coverage-manifest.json counts declarations, so a
  // row deleted from a table would delete a case the ratchet cannot see (assert-no-loop-cases).
  const refuses = (over) => {
    const v = decide({ jobs: [gateJob('web')], ...base, ...over });
    assert.equal(v.action, 'none', `expected none, got ${v.action}: ${v.why}`);
  };
  test('a REAL deploy step failed', () => refuses({ jobs: [realJob('web')] }));
  test('one matrix leg failed on the gate, another on a real step', () =>
    refuses({ jobs: [gateJob('web-a'), realJob('web-b')] }));
  test('a job failed with no failed step (runner loss / timeout)', () =>
    refuses({ jobs: [{ name: 'web', conclusion: 'failure', steps: [] }] }));
  test('ci-gate at head is RED', () => refuses({ gate: { status: 'completed', conclusion: 'failure' } }));
  test('ci-gate at head is still running', () => refuses({ gate: { status: 'in_progress', conclusion: null } }));
  test('ci-gate at head was never reported', () => refuses({ gate: null }));
  test('the lane has no run on main', () => refuses({ runs: [] }));
  test('the lane has only a pull_request run', () =>
    refuses({ runs: [run({ id: 9, run_number: 9, head_sha: X, event: 'pull_request' })] }));
  test('the newest run is still in progress', () =>
    refuses({ runs: [run({ id: 427, run_number: 427, head_sha: Y, status: 'in_progress', conclusion: null })] }));
  test('the newest run succeeded; an OLDER one was stranded (a re-run would roll back)', () =>
    refuses({ runs: [run({ id: 426, run_number: 426, head_sha: X }), run({ id: 427, run_number: 427, head_sha: Y, conclusion: 'success' })] }));
  test('the newest run was cancelled', () =>
    refuses({ runs: [run({ id: 426, run_number: 426, head_sha: X, conclusion: 'cancelled' })] }));
  test('a same-SHA run already failed the gate on attempt 2', () =>
    refuses({ head: X, runs: [run({ id: 426, run_number: 426, head_sha: X, run_attempt: 2 })] }));
  test('the stranded SHA is not an ancestor of head', () => refuses({ relation: 'diverged' }));
  test('Build apps: a platform job failed on a REAL build step, and all-platforms with it', () =>
    refuses({ lane: BP, jobs: [
      { name: 'Require ci-gate to have passed', conclusion: 'success', steps: [{ name: GATE_STEP, conclusion: 'success' }] },
      realJob('Linux + Web + Android'), aggJob('all-platforms')] }));
  test('Build apps: ONLY all-platforms failed, the gate job passed — a consequence job alone is never a strand', () =>
    refuses({ lane: BP, jobs: [
      { name: 'Require ci-gate to have passed', conclusion: 'success', steps: [{ name: GATE_STEP, conclusion: 'success' }] },
      aggJob('all-platforms')] }));
  test('a deploy lane (no consequence jobs) with an "all-platforms" failure beside its gate job', () =>
    refuses({ lane: LANE, jobs: [gateJob('web'), aggJob('all-platforms')] }));
  test('Build apps: a later schedule SUCCESS supersedes the older failed dispatch', () =>
    refuses({ lane: BP, jobs: bpStranded(), runs: [
      run({ id: 1020, run_number: 102, head_sha: X, event: 'workflow_dispatch' }),
      run({ id: 1030, run_number: 103, head_sha: Y, event: 'schedule', conclusion: 'success' })] }));
  test('Build apps: a same-SHA schedule run already failed the gate on attempt 2', () =>
    refuses({ lane: BP, jobs: bpStranded(), head: Y,
      runs: [run({ id: 1030, run_number: 103, head_sha: Y, event: 'schedule', run_attempt: 2 })] }));
});

// ═══════════════════════════════════════════════════════════════════════════
describe('derivation — against the real tree', () => {
  test('the derived lanes are exactly build-platforms.yml, with its named gate step', () => {
    const { lanes, problems } = deployLanes(REPO);
    assert.deepEqual(problems, []);
    assert.deepEqual(lanes.map((l) => l.file).sort(), ['build-platforms.yml']);
    for (const l of lanes) assert.equal(l.gateStep, GATE_STEP, l.file);
  });

  test('deploy-web.yml and deploy-workers.yml are NOT derived: call-only, they fail L1 (no dispatch, no push)', () => {
    for (const f of ['deploy-web.yml', 'deploy-workers.yml']) {
      const ev = workflowEvents(parseWorkflow(REPO, `.github/workflows/${f}`));
      assert.deepEqual([...ev], ['workflow_call'], `the premise moved: ${f} starts on more than a call`);
    }
    const legacy = deployLanes(legacyRoot()).lanes.map((l) => l.file).sort();
    assert.deepEqual(legacy, ['build-platforms.yml', 'deploy-web.yml', 'deploy-workers.yml'], 'the legacy fixture no longer derives the old lanes');
    // The legacy lanes' `always()` would be step-level; only a JOB-level one is a consequence.
    for (const l of deployLanes(legacyRoot()).lanes.filter((x) => x.file !== 'build-platforms.yml')) assert.deepEqual(l.consequenceJobs, [], l.file);
  });

  test('build-platforms: its one consequence job is all-platforms, the channel register\'s aggregatingJob', () => {
    const bp = deployLanes(REPO).lanes.find((l) => l.file === 'build-platforms.yml');
    assert.ok(bp, 'build-platforms.yml was not derived');
    assert.equal(bp.gateStep, GATE_STEP);
    assert.deepEqual(bp.consequenceJobs, ['all-platforms']);
    const agg = JSON.parse(readFileSync(join(REPO, CHANNEL_REGISTER), 'utf8')).aggregatingJob;
    const wf = parseWorkflow(REPO, agg.workflow);
    const job = wf.jobs.get(agg.job);
    assert.ok(job, `${agg.workflow} has no job ${agg.job}`);
    assert.ok(bp.consequenceJobs.includes(job.displayName ?? agg.job), 'the aggregate the channel register names is not a consequence job');
  });

  test('extensions.yml is NOT derived although it has a schedule and a dispatch', () => {
    const wf = parseWorkflow(REPO, '.github/workflows/extensions.yml');
    const ev = workflowEvents(wf);
    assert.ok(ev.has('schedule') && ev.has('workflow_dispatch'), 'the premise moved: extensions.yml lost its schedule or dispatch');
    assert.equal(deployLanes(REPO).lanes.some((l) => l.file === 'extensions.yml'), false);
  });

  test('the gate check name is read from ci.yml and is ci-gate', () => {
    assert.equal(gateCheckName(REPO), 'ci-gate');
  });

  test(`${RECOVERY_WORKFLOW} listens to exactly CI plus every derived lane`, () => {
    assert.equal(triggerProblem(REPO, deployLanes(REPO).lanes), null);
  });
});

describe('derivation — MUTATIONS the trigger check must catch', () => {
  // The workflows AND the channel register: L4 reads the register, and a root
  // without it is exit 2 (COULD NOT LOOK), which would hide every other verdict.
  const mutated = (edit) => {
    const root = tmp();
    cpSync(join(REPO, '.github', 'workflows'), join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    cpSync(join(REPO, CHANNEL_REGISTER), join(root, CHANNEL_REGISTER));
    edit(root);
    return root;
  };
  const rewrite = (root, rel, from, to) => {
    const p = join(root, rel);
    const before = readFileSync(p, 'utf8');
    const after = before.replace(from, to);
    assert.notEqual(after, before, `mutation did not apply to ${rel}`);
    writeFileSync(p, after);
  };
  const derived = (root) => deployLanes(root).lanes.map((l) => l.file);
  const SCHEDULE = "  schedule:\n    - cron: '0 6 * * 1'\n";

  test('a lane dropped from the trigger list (legacy tree) → MISSING, and the CLI refuses (exit 2)', () => {
    const root = legacyRoot((r) => rewrite(r, RECOVERY_WORKFLOW, LEGACY_TRIGGER, 'workflows: [CI, Deploy web, Build apps]'));
    assert.match(triggerProblem(root, deployLanes(root).lanes) ?? '', /MISSING Deploy workers/);
    const r = cli(['--root', root], { REDEPLOY_STRANDED_FIXTURE: writeFixture(tonight()) });
    assert.equal(r.status, 2, r.stderr);
  });

  test('Build apps dropped from the trigger list → MISSING Build apps, and the CLI refuses (exit 2)', () => {
    const root = mutated((r) => rewrite(r, RECOVERY_WORKFLOW, 'workflows: [CI, Build apps]', 'workflows: [CI]'));
    assert.match(triggerProblem(root, deployLanes(root).lanes) ?? '', /MISSING Build apps/);
    const r = cli(['--root', root], { REDEPLOY_STRANDED_FIXTURE: writeFixture(tonight()) });
    assert.equal(r.status, 2, r.stderr);
  });

  test('L4 alone: submit-appstore.yml (no inputs, unconditional gate) given a schedule is still not a lane', () => {
    const root = mutated((r) => rewrite(r, '.github/workflows/submit-appstore.yml', 'on:\n  workflow_dispatch:\n', `on:\n  workflow_dispatch:\n${SCHEDULE}`));
    assert.equal(derived(root).includes('submit-appstore.yml'), false);
    assert.equal(triggerProblem(root, deployLanes(root).lanes), null);
  });

  test('L2 + L4: submit-play.yml given a schedule is still not a lane', () => {
    const root = mutated((r) => rewrite(r, '.github/workflows/submit-play.yml', 'on:\n  workflow_dispatch:\n', `on:\n${SCHEDULE}  workflow_dispatch:\n`));
    assert.equal(derived(root).includes('submit-play.yml'), false);
  });

  test('L3: extensions.yml with its dispatch `inputs:` removed is still not a lane (its gate job is conditional)', () => {
    const root = mutated((r) => {
      const p = join(r, '.github', 'workflows', 'extensions.yml');
      const lines = readFileSync(p, 'utf8').split('\n');
      const at = lines.findIndex((l, i) => l === '    inputs:' && lines[i - 1] === '  workflow_dispatch:');
      assert.ok(at > 0, 'extensions.yml has no `inputs:` under `workflow_dispatch:` to remove');
      let end = at + 1;
      while (end < lines.length && (lines[end].trim() === '' || /^ {5,}/.test(lines[end]))) end++;
      lines.splice(at, end - at);
      writeFileSync(p, lines.join('\n'));
    });
    assert.equal(derived(root).includes('extensions.yml'), false);
  });

  test('L3 alone: a job-level `if:` on build-platforms\' gate job takes it out', () => {
    const root = mutated((r) => rewrite(r, '.github/workflows/build-platforms.yml',
      '  gate:\n    name: Require ci-gate to have passed\n',
      "  gate:\n    name: Require ci-gate to have passed\n    if: github.event_name == 'schedule'\n"));
    assert.equal(derived(root).includes('build-platforms.yml'), false);
  });

  test('L2 alone: a dispatch `inputs:` block on build-platforms takes it out', () => {
    const root = mutated((r) => rewrite(r, '.github/workflows/build-platforms.yml',
      'on:\n  workflow_dispatch:\n  push:\n',
      'on:\n  workflow_dispatch:\n    inputs:\n      flavour:\n        type: string\n        required: false\n  push:\n'));
    assert.equal(derived(root).includes('build-platforms.yml'), false);
  });

  test('L4 alone: build-platforms named as a channel\'s submission workflow takes it out', () => {
    const root = mutated((r) => {
      const p = join(r, CHANNEL_REGISTER);
      const reg = JSON.parse(readFileSync(p, 'utf8'));
      const ch = reg.channels.find((c) => c.submission?.workflow);
      assert.ok(ch, 'no channel carries a submission block to repoint');
      ch.submission.workflow = '.github/workflows/build-platforms.yml';
      writeFileSync(p, JSON.stringify(reg, null, 2));
    });
    assert.equal(derived(root).includes('build-platforms.yml'), false);
  });

  test('L1 is the only thing keeping symbolication-proof.yml out: a schedule derives it, and the trigger check sees it', () => {
    const root = mutated((r) => rewrite(r, '.github/workflows/symbolication-proof.yml', '  workflow_dispatch:\n', `  workflow_dispatch:\n${SCHEDULE}`));
    assert.ok(derived(root).includes('symbolication-proof.yml'), derived(root).join(', '));
    assert.match(triggerProblem(root, deployLanes(root).lanes) ?? '', /MISSING Symbolication proof/);
  });

  test('a third gated lane nobody added to the trigger → MISSING', () => {
    const root = mutated((r) => {
      const src = readFileSync(join(r, '.github', 'workflows', 'build-platforms.yml'), 'utf8');
      writeFileSync(join(r, '.github', 'workflows', 'deploy-third.yml'), src.replace(/^name: .*$/m, 'name: Deploy third'));
    });
    assert.match(triggerProblem(root, deployLanes(root).lanes) ?? '', /MISSING Deploy third/);
  });

  test('a gate step with no name (legacy tree) → a derivation problem, never a silent "real step failed"', () => {
    const root = legacyRoot((r) => rewrite(r, '.github/workflows/deploy-workers.yml', `name: ${GATE_STEP}`, ''));
    const { problems } = deployLanes(root);
    assert.ok(problems.some((p) => p.includes('deploy-workers.yml') && /no `name:`/.test(p)), problems.join('\n'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The 2026-09-22 tree: the real workflows and channel register, with deploy-web.yml
// and deploy-workers.yml written back as the push-on-main, dispatchable, self-
// gated lanes they were before ADR 095 §4, and the recovery trigger listening to
// them again. `edit` mutates the copy before it is returned.
const LEGACY_TRIGGER = 'workflows: [CI, Deploy web, Deploy workers, Build apps]';
const LEGACY_ON = 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\n';
const LEGACY_GATE = `      - name: ${GATE_STEP}\n        run: node tooling/ci/assert-gate-passed.mjs\n`;
const LEGACY = {
  'deploy-web.yml': `name: Deploy web\n\n${LEGACY_ON}jobs:\n  web:\n    name: Build & deploy web to Cloudflare Pages (subscriptiontracker)\n    runs-on: ubuntu-24.04\n    steps:\n${LEGACY_GATE}      - name: Deploy\n        run: echo deploy\n`,
  'deploy-workers.yml': `name: Deploy workers\n\n${LEGACY_ON}jobs:\n  detect:\n    runs-on: ubuntu-24.04\n    steps:\n${LEGACY_GATE}  deploy-api:\n    needs: [detect]\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo deploy\n`,
};
function legacyRoot(edit = () => {}) {
  const root = tmp();
  cpSync(join(REPO, '.github', 'workflows'), join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'tooling'), { recursive: true });
  cpSync(join(REPO, CHANNEL_REGISTER), join(root, CHANNEL_REGISTER));
  for (const [f, text] of Object.entries(LEGACY)) writeFileSync(join(root, '.github', 'workflows', f), text);
  const trig = join(root, RECOVERY_WORKFLOW);
  const before = readFileSync(trig, 'utf8');
  const after = before.replace('workflows: [CI, Build apps]', LEGACY_TRIGGER);
  assert.notEqual(after, before, `${RECOVERY_WORKFLOW} no longer reads \`workflows: [CI, Build apps]\``);
  writeFileSync(trig, after);
  edit(root);
  return root;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI over the fixture transport, on the legacy tree above (the real tree has no
// deploy lane left to strand).
function tonight() {
  return {
    head: Y,
    gate: GREEN,
    runs: {
      'deploy-web.yml': [run({ id: 4260, run_number: 426, head_sha: X }), run({ id: 4250, run_number: 425, head_sha: 'b'.repeat(40), conclusion: 'success' })],
      'deploy-workers.yml': [run({ id: 1680, run_number: 168, head_sha: X })],
      // Build apps is green here: TONIGHT is the 2026-09-22 instance, before it was a lane.
      'build-platforms.yml': [run({ id: 1010, run_number: 101, head_sha: 'c'.repeat(40), event: 'workflow_dispatch', conclusion: 'success' })],
    },
    jobs: {
      4260: [gateJob('Build & deploy web to Cloudflare Pages (subscriptiontracker)')],
      1680: [gateJob('detect'), skippedJob('deploy-api')],
    },
    compare: { [`${X}...${Y}`]: 'ahead' },
  };
}
function writeFixture(fx) {
  const p = join(tmp(), 'fixture.json');
  writeFileSync(p, JSON.stringify(fx));
  return p;
}
function cli(args, env) {
  const clean = { ...process.env };
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'REDEPLOY_STRANDED_FIXTURE', 'REDEPLOY_STRANDED_FIXTURE_LOG']) delete clean[k];
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...clean, ...env }, timeout: 60_000 });
}

describe('CLI — fixture transport', () => {
  test('TONIGHT: both lanes are dispatched on main, exit 0', () => {
    const log = join(tmp(), 'actions.log');
    const r = cli(['--root', legacyRoot()], { REDEPLOY_STRANDED_FIXTURE: writeFixture(tonight()), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').sort(), ['dispatch deploy-web.yml ref=main', 'dispatch deploy-workers.yml ref=main']);
  });

  test('REPLAY 35800063831: Build apps stranded by the Worker dispatch is dispatched on main beside the deploy lanes', () => {
    const fx = tonight();
    fx.runs['build-platforms.yml'].unshift(run({ id: 1020, run_number: 102, head_sha: X, event: 'workflow_dispatch' }));
    fx.jobs[1020] = bpStranded();
    const log = join(tmp(), 'actions.log');
    const r = cli(['--root', legacyRoot()], { REDEPLOY_STRANDED_FIXTURE: writeFixture(fx), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').sort(),
      ['dispatch build-platforms.yml ref=main', 'dispatch deploy-web.yml ref=main', 'dispatch deploy-workers.yml ref=main']);
  });

  test('SAME-SHA: the stranded run at head is re-run through safe-rerun --failed', () => {
    const fx = tonight();
    fx.head = X;
    delete fx.runs['deploy-workers.yml'];
    fx.runs['deploy-workers.yml'] = [run({ id: 1690, run_number: 169, head_sha: X, conclusion: 'success' })];
    const log = join(tmp(), 'actions.log');
    const r = cli(['--root', legacyRoot()], { REDEPLOY_STRANDED_FIXTURE: writeFixture(fx), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(log, 'utf8').trim(), 'rerun 4260 --failed');
  });

  test('RED CONTROL: a real deploy-step failure is never re-entered — the log does not exist', () => {
    const fx = tonight();
    fx.jobs[4260] = [realJob('web')];
    fx.jobs[1680] = [realJob('deploy-api')];
    const log = join(tmp(), 'actions.log');
    const r = cli(['--root', legacyRoot()], { REDEPLOY_STRANDED_FIXTURE: writeFixture(fx), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(log), false, 'an action was requested over a genuine deploy failure');
  });

  test('RED CONTROL: ci-gate at head not green — nothing is requested', () => {
    const fx = tonight();
    fx.gate = { status: 'completed', conclusion: 'failure' };
    const log = join(tmp(), 'actions.log');
    const r = cli(['--root', legacyRoot()], { REDEPLOY_STRANDED_FIXTURE: writeFixture(fx), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(log), false);
  });

  test('--dry-run decides and requests nothing', () => {
    const log = join(tmp(), 'actions.log');
    const r = cli(['--dry-run', '--root', legacyRoot()], { REDEPLOY_STRANDED_FIXTURE: writeFixture(tonight()), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DISPATCH/);
    assert.equal(existsSync(log), false);
  });

  test('an unreadable answer is COULD NOT LOOK (2), never "nothing stranded"', () => {
    const fx = tonight();
    delete fx.jobs[1680];
    const r = cli(['--root', legacyRoot()], { REDEPLOY_STRANDED_FIXTURE: writeFixture(fx), REDEPLOY_STRANDED_FIXTURE_LOG: join(tmp(), 'a.log') });
    assert.equal(r.status, 2, r.stderr);
  });

  test('no credential and no fixture → exit 2', () => {
    const r = cli([], { GITHUB_REPOSITORY: 'o/n' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /COULD NOT LOOK/);
  });
});
