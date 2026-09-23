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
// tree (exactly deploy-web.yml and deploy-workers.yml), and by mutation — a
// trigger list missing a lane, and a third gated lane nobody added to the
// trigger, must each make the tool refuse to run (exit 2).
//
// NOTHING HERE TOUCHES THE NETWORK. Every CLI case runs the fixture transport,
// which has no fetch in it; the one live-shaped case withholds the credential.
//
// Run:  node --test tooling/ci/test/redeploy-stranded.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decide,
  deployLanes,
  gateCheckName,
  triggerProblem,
  rerunArgv,
  RECOVERY_WORKFLOW,
} from '../../ops/redeploy-stranded.mjs';

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
const LANE = { file: 'deploy-web.yml', gateStep: GATE_STEP };

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

describe('decide — RED CONTROLS: nothing is re-entered', () => {
  const base = { lane: LANE, head: Y, gate: GREEN, runs: [run({ id: 426, run_number: 426, head_sha: X })], relation: 'ahead' };
  const cases = [
    ['a REAL deploy step failed', { jobs: [realJob('web')] }],
    ['one matrix leg failed on the gate, another on a real step', { jobs: [gateJob('web-a'), realJob('web-b')] }],
    ['a job failed with no failed step (runner loss / timeout)', { jobs: [{ name: 'web', conclusion: 'failure', steps: [] }] }],
    ['ci-gate at head is RED', { gate: { status: 'completed', conclusion: 'failure' } }],
    ['ci-gate at head is still running', { gate: { status: 'in_progress', conclusion: null } }],
    ['ci-gate at head was never reported', { gate: null }],
    ['the lane has no run on main', { runs: [] }],
    ['the lane has only a pull_request run', { runs: [run({ id: 9, run_number: 9, head_sha: X, event: 'pull_request' })] }],
    ['the newest run is still in progress', { runs: [run({ id: 427, run_number: 427, head_sha: Y, status: 'in_progress', conclusion: null })] }],
    ['the newest run succeeded; an OLDER one was stranded (a re-run would roll back)', {
      runs: [run({ id: 426, run_number: 426, head_sha: X }), run({ id: 427, run_number: 427, head_sha: Y, conclusion: 'success' })] }],
    ['the newest run was cancelled', { runs: [run({ id: 426, run_number: 426, head_sha: X, conclusion: 'cancelled' })] }],
    ['a same-SHA run already failed the gate on attempt 2', { head: X, runs: [run({ id: 426, run_number: 426, head_sha: X, run_attempt: 2 })] }],
    ['the stranded SHA is not an ancestor of head', { relation: 'diverged' }],
  ];
  for (const [why, over] of cases) {
    test(why, () => {
      const v = decide({ jobs: [gateJob('web')], ...base, ...over });
      assert.equal(v.action, 'none', `expected none, got ${v.action}: ${v.why}`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
describe('derivation — against the real tree', () => {
  test('the derived lanes are exactly deploy-web.yml and deploy-workers.yml, each with its named gate step', () => {
    const { lanes, problems } = deployLanes(REPO);
    assert.deepEqual(problems, []);
    assert.deepEqual(lanes.map((l) => l.file).sort(), ['deploy-web.yml', 'deploy-workers.yml']);
    for (const l of lanes) assert.equal(l.gateStep, GATE_STEP, l.file);
  });

  test('the gate check name is read from ci.yml and is ci-gate', () => {
    assert.equal(gateCheckName(REPO), 'ci-gate');
  });

  test(`${RECOVERY_WORKFLOW} listens to exactly CI plus every derived lane`, () => {
    assert.equal(triggerProblem(REPO, deployLanes(REPO).lanes), null);
  });
});

describe('derivation — MUTATIONS the trigger check must catch', () => {
  const mutated = (edit) => {
    const root = tmp();
    cpSync(join(REPO, '.github', 'workflows'), join(root, '.github', 'workflows'), { recursive: true });
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

  test('a lane dropped from the trigger list → MISSING, and the CLI refuses (exit 2)', () => {
    const root = mutated((r) => rewrite(r, RECOVERY_WORKFLOW, 'workflows: [CI, Deploy web, Deploy workers]', 'workflows: [CI, Deploy web]'));
    assert.match(triggerProblem(root, deployLanes(root).lanes) ?? '', /MISSING Deploy workers/);
    const r = cli(['--root', root], { REDEPLOY_STRANDED_FIXTURE: writeFixture(tonight()) });
    assert.equal(r.status, 2, r.stderr);
  });

  test('a third gated lane nobody added to the trigger → MISSING', () => {
    const root = mutated((r) => {
      const src = readFileSync(join(r, '.github', 'workflows', 'deploy-web.yml'), 'utf8');
      writeFileSync(join(r, '.github', 'workflows', 'deploy-third.yml'), src.replace(/^name: .*$/m, 'name: Deploy third'));
    });
    assert.match(triggerProblem(root, deployLanes(root).lanes) ?? '', /MISSING Deploy third/);
  });

  test('a gate step with no name → a derivation problem, never a silent "real step failed"', () => {
    const root = mutated((r) => rewrite(r, '.github/workflows/deploy-workers.yml', `name: ${GATE_STEP}`, ''));
    const { problems } = deployLanes(root);
    assert.ok(problems.some((p) => p.includes('deploy-workers.yml') && /no `name:`/.test(p)), problems.join('\n'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CLI over the fixture transport, on the real tree.
function tonight() {
  return {
    head: Y,
    gate: GREEN,
    runs: {
      'deploy-web.yml': [run({ id: 4260, run_number: 426, head_sha: X }), run({ id: 4250, run_number: 425, head_sha: 'b'.repeat(40), conclusion: 'success' })],
      'deploy-workers.yml': [run({ id: 1680, run_number: 168, head_sha: X })],
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
    const r = cli([], { REDEPLOY_STRANDED_FIXTURE: writeFixture(tonight()), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').sort(), ['dispatch deploy-web.yml ref=main', 'dispatch deploy-workers.yml ref=main']);
  });

  test('SAME-SHA: the stranded run at head is re-run through safe-rerun --failed', () => {
    const fx = tonight();
    fx.head = X;
    delete fx.runs['deploy-workers.yml'];
    fx.runs['deploy-workers.yml'] = [run({ id: 1690, run_number: 169, head_sha: X, conclusion: 'success' })];
    const log = join(tmp(), 'actions.log');
    const r = cli([], { REDEPLOY_STRANDED_FIXTURE: writeFixture(fx), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(log, 'utf8').trim(), 'rerun 4260 --failed');
  });

  test('RED CONTROL: a real deploy-step failure is never re-entered — the log does not exist', () => {
    const fx = tonight();
    fx.jobs[4260] = [realJob('web')];
    fx.jobs[1680] = [realJob('deploy-api')];
    const log = join(tmp(), 'actions.log');
    const r = cli([], { REDEPLOY_STRANDED_FIXTURE: writeFixture(fx), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(log), false, 'an action was requested over a genuine deploy failure');
  });

  test('RED CONTROL: ci-gate at head not green — nothing is requested', () => {
    const fx = tonight();
    fx.gate = { status: 'completed', conclusion: 'failure' };
    const log = join(tmp(), 'actions.log');
    const r = cli([], { REDEPLOY_STRANDED_FIXTURE: writeFixture(fx), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(log), false);
  });

  test('--dry-run decides and requests nothing', () => {
    const log = join(tmp(), 'actions.log');
    const r = cli(['--dry-run'], { REDEPLOY_STRANDED_FIXTURE: writeFixture(tonight()), REDEPLOY_STRANDED_FIXTURE_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DISPATCH/);
    assert.equal(existsSync(log), false);
  });

  test('an unreadable answer is COULD NOT LOOK (2), never "nothing stranded"', () => {
    const fx = tonight();
    delete fx.jobs[1680];
    const r = cli([], { REDEPLOY_STRANDED_FIXTURE: writeFixture(fx), REDEPLOY_STRANDED_FIXTURE_LOG: join(tmp(), 'a.log') });
    assert.equal(r.status, 2, r.stderr);
  });

  test('no credential and no fixture → exit 2', () => {
    const r = cli([], { GITHUB_REPOSITORY: 'o/n' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /COULD NOT LOOK/);
  });
});
