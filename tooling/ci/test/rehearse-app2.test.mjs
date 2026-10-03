// ─────────────────────────────────────────────────────────────────────────────
// rehearse-app2.test.mjs — tooling/kit/rehearse-app2.mjs, its step register,
// its workflow and tooling/kit/rehearsal-trend.mjs. [lane app2-dryrun]
// Row: O-TIME-TO-SHIP-UNMEASURED.
//
// Each red runs after its green control on the same input:
//   T1  a deliberately broken step (a real process exiting 1) is reported as
//       THAT step's failure and the run exits 1 — never an overall pass
//   T2  a step that hand-edits a file the kit should own is manual; with no row
//       the run exits 1, with one it exits 0
//   T3  a step whose tool is not on PATH is a SKIP and the run exits 2
//   T4  the kit's readout becomes manual steps, mapped to rows; an unmapped one
//       is a finding
//   T5  the workflow: scheduled, dispatchable, no secret, no write permission;
//       a secret or a write permission added to the real file fails
//   T6  the trend: a manual step that became automated is printed, and runner
//       noise is not
//   T7  the time-to-ship fact is {value, asOf, verify}
//   T8  the real register: every manual step names a row, every auto step a
//       command, and every target is exercised or listed with its reason
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WORKFLOW, exitCode, loadSteps, readoutSteps, runSteps, spawnRun, summarize, workflowProblems } from '../../kit/rehearse-app2.mjs';
import { trend } from '../../kit/rehearsal-trend.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ctx = (tree) => ({ tree, id: 'rehearsalfx', vars: join(tree, 'vars.json'), has: () => true });
const node = (code) => ({ kind: 'auto', argv: ['node', '-e', code] });

describe('T1 · a broken step is that step\'s failure, never an overall pass', () => {
  test('a real process exiting 1 fails its step and the run', () => {
    const tree = mkdtempSync(join(tmpdir(), 'nk-rehearse-'));
    try {
      const green = runSteps([{ name: 'stamp', ...node('process.exit(0)') }, { name: 'analyze', ...node('process.exit(0)') }], ctx(tree));
      assert.deepEqual(green.map((r) => r.result), ['pass', 'pass']);
      assert.equal(exitCode(summarize(green, { asOf: '2026-10-03', id: 'x' })), 0);
      const red = runSteps([{ name: 'stamp', ...node('console.error("brick refused the id"); process.exit(1)') }, { name: 'analyze', ...node('process.exit(0)') }], ctx(tree));
      assert.equal(red[0].result, 'fail');
      assert.match(red[0].why, /exit 1: brick refused the id/);
      assert.equal(red[1].result, 'pass');
      const s = summarize(red, { asOf: '2026-10-03', id: 'x' });
      assert.deepEqual(s.failedSteps, ['stamp']);
      assert.equal(exitCode(s), 1);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
  test('the second command of a multi-command step failing fails the step', () => {
    const tree = mkdtempSync(join(tmpdir(), 'nk-rehearse-'));
    try {
      const r = runSteps([{ name: 'worker', kind: 'auto', argvs: [['node', '-e', '0'], ['node', '-e', 'process.exit(3)']] }], ctx(tree));
      assert.equal(r[0].result, 'fail');
      assert.match(r[0].why, /exit 3/);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
});

describe('T2 · a hand edit is a manual step, and a manual step needs its row', () => {
  const refused = () => ({ status: 1, out: '✗ rehearsalfx_db is in NONE of the nightly backup\n' });
  const accepted = () => ({ status: 0, out: 'ok\n' });
  const step = (extra) => ({ name: 'backup set', kind: 'auto', argv: ['x'], handEdits: ['tooling/platform-register.json'], ...extra });
  test('a hand-edit step whose check fails is manual, not failed; no row exits 1, a row exits 0', () => {
    const plain = runSteps([{ name: 'backup set', kind: 'auto', argv: ['x'] }], { ...ctx('.'), run: refused });
    assert.deepEqual([plain[0].result, plain[0].manual], ['fail', false], 'green control: without handEdits a refusal is a failure');
    const edited = runSteps([step()], { ...ctx('.'), run: refused });
    assert.deepEqual([edited[0].result, edited[0].manual], ['manual', true]);
    assert.match(edited[0].why, /needs a hand edit of tooling\/platform-register\.json, which the kit should own/);
    assert.match(edited[0].why, /in NONE of the nightly backup/, 'the refusal says what the person must do');
    const s = summarize(edited, { asOf: '2026-10-03', id: 'x' });
    assert.deepEqual([s.failedSteps, s.unmappedManualSteps], [[], ['backup set']]);
    assert.equal(exitCode(s), 1);
    const mapped = runSteps([step({ row: 'O-BACKUP-AND-FANOUT-SETS-HAND-LISTED' })], { ...ctx('.'), run: refused });
    assert.equal(exitCode(summarize(mapped, { asOf: '2026-10-03', id: 'x' })), 0);
  });
  test('the same step passing untouched is automatic', () => {
    const r = runSteps([step({ row: 'O-BACKUP-AND-FANOUT-SETS-HAND-LISTED' })], { ...ctx('.'), run: accepted });
    assert.deepEqual([r[0].result, r[0].manual], ['pass', false]);
  });
});

describe('T2b · a declared refusal is gated or manual; any OTHER failure of the step stays a failure', () => {
  const step = { name: 'submitter dry run: Google Play', kind: 'auto', argv: ['x'], refusal: { match: 'has status "preview" and only "live" may be submitted', gate: '[pipeline 10]D-6 web-prove-first', why: 'web-prove-first.' } };
  test('the expected refusal is GATED and owned; another refusal is a failure', () => {
    const gated = runSteps([step], { ...ctx('.'), run: () => ({ status: 1, out: '✗ app "x" has status "preview" and only "live" may be submitted to a store.\n' }) });
    assert.deepEqual([gated[0].result, gated[0].manual, gated[0].gate], ['gated', true, '[pipeline 10]D-6 web-prove-first']);
    assert.equal(exitCode(summarize(gated, { asOf: '2026-10-03', id: 'x' })), 0, 'a gate is owned, not unmapped');
    const other = runSteps([step], { ...ctx('.'), run: () => ({ status: 1, out: 'FAIL metadata tree apps/x/store/android-play is missing title.txt\n' }) });
    assert.deepEqual([other[0].result, other[0].manual], ['fail', false]);
    assert.equal(exitCode(summarize(other, { asOf: '2026-10-03', id: 'x' })), 1);
  });
});

describe('T3 · a skipped step is COVERAGE LOST, not a pass', () => {
  test('a tool not on PATH skips the step and the run exits 2', () => {
    const r = runSteps([{ name: 'analyze', kind: 'auto', needs: ['no-such-tool-xyz'], argv: ['no-such-tool-xyz'] }], { ...ctx('.'), has: () => false });
    assert.equal(r[0].result, 'skip');
    assert.equal(exitCode(summarize(r, { asOf: '2026-10-03', id: 'x' })), 2);
  });
});

describe('T4 · the kit\'s readout becomes manual steps', () => {
  const text = [
    'new-product plan rehearsalfx (app)',
    'DONE id — "rehearsalfx" is admitted',
    'OWNER store records — pending: windows-store, android-play',
    'NEXT name clearance — apps/rehearsalfx/name-clearance.json does not exist',
    'NEXT price row — no apps.rehearsalfx row',
    'summary: 1 DONE, 2 NEXT, 1 OWNER',
  ].join('\n');
  test('OWNER and NEXT lines are manual, mapped through the rows; DONE is not', () => {
    const steps = readoutSteps(text, { 'store records': 'O-STORE-RECORDS-ARE-ONE-PER-CHANNEL', 'price row': 'O-NEW-APP-ROWS-ARE-HAND-TYPED' });
    assert.deepEqual(steps.map((s) => s.name), ['readout: store records', 'readout: name clearance', 'readout: price row']);
    assert.equal(steps[0].row, 'O-STORE-RECORDS-ARE-ONE-PER-CHANNEL');
    const s = summarize(steps, { asOf: '2026-10-03', id: 'x' });
    assert.deepEqual(s.unmappedManualSteps, ['readout: name clearance']);
    assert.equal(exitCode(s), 1);
  });
  test('a readout step a scheduled lane already does is automated, not manual', () => {
    const steps = readoutSteps(text, {}, {}, { 'name clearance': '.github/workflows/name-clearance.yml' });
    const nc = steps.find((s) => s.name === 'readout: name clearance');
    assert.deepEqual([nc.result, nc.manual], ['lane', false]);
    assert.match(nc.why, /done by \.github\/workflows\/name-clearance\.yml/);
    assert.ok(!summarize(steps, { asOf: '2026-10-03', id: 'x' }).unmappedManualSteps.includes('readout: name clearance'));
  });
  test('the real new-product readout parses (subscriptiontracker: two OWNER steps)', () => {
    const r = spawnRun(['node', 'tooling/kit/new-product.mjs', 'plan', 'subscriptiontracker'], { cwd: ROOT, env: process.env });
    assert.equal(r.status, 0, r.out);
    const steps = readoutSteps(r.out, loadSteps(ROOT).readoutRows);
    assert.ok(steps.length >= 1, 'the real readout yields manual steps');
    assert.ok(steps.every((s) => s.manual));
  });
});

describe('T5 · the workflow reads no secret and writes nothing', () => {
  const real = readFileSync(join(ROOT, WORKFLOW), 'utf8');
  test('the real workflow passes', () => {
    assert.deepEqual(workflowProblems(real), []);
  });
  // Each mutation is asserted to have changed the file first: a replace that matches nothing
  // would leave the real file, pass it, and prove nothing.
  const mutate = (from, to) => {
    const m = real.replace(from, to);
    assert.notEqual(m, real, `the mutation ${from} matched nothing in ${WORKFLOW}`);
    return m;
  };
  test('a secret, a write permission or a missing schedule fails', () => {
    assert.match(workflowProblems(mutate('      contents: read', '      contents: write'))[0], /grants `contents: write`/);
    assert.match(workflowProblems(mutate('        id: rehearse\n', '        id: rehearse\n        env:\n          T: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}\n'))[0], /reads a secret/);
    assert.ok(workflowProblems(mutate(/ {2}schedule:\r?\n.*\r?\n/, '')).some((p) => /no `schedule`/.test(p)));
  });
});

describe('T6 · a trend, not a snapshot', () => {
  const report = (steps, value) => ({ id: 'r', ranAt: 't', steps, totals: { timeToShip: { value, unit: 'hours', asOf: '2026-10-03' } } });
  test('a manual step that became automated is printed; noise is not', () => {
    const prev = report([{ name: 'store lanes', manual: true, result: 'manual', seconds: 0 }, { name: 'stamp', manual: false, result: 'pass', seconds: 100 }, { name: 'tests', manual: false, result: 'pass', seconds: 60 }], 40);
    const same = trend(prev, prev);
    assert.deepEqual([same.newlyAutomated, same.faster, same.slower], [[], [], []]);
    const next = report([{ name: 'store lanes', manual: false, result: 'pass', seconds: 30 }, { name: 'stamp', manual: false, result: 'pass', seconds: 104 }, { name: 'tests', manual: false, result: 'pass', seconds: 20 }], 39);
    const t = trend(prev, next);
    assert.deepEqual(t.newlyAutomated, ['store lanes']);
    assert.deepEqual(t.faster, [{ name: 'tests', from: 60, to: 20 }]);
    assert.deepEqual(t.slower, [], 'a 4 s move on a 100 s step is runner noise');
  });
  test('the CLI prints NEWLY AUTOMATED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nk-trend-'));
    try {
      writeFileSync(join(dir, 'a.json'), JSON.stringify(report([{ name: 'e2e', manual: true, result: 'manual', seconds: 0 }], 40)));
      writeFileSync(join(dir, 'b.json'), JSON.stringify(report([{ name: 'e2e', manual: false, result: 'pass', seconds: 9 }], 39)));
      const r = spawnSync(process.execPath, [join(ROOT, 'tooling/kit/rehearsal-trend.mjs'), join(dir, 'a.json'), join(dir, 'b.json')], { encoding: 'utf8' });
      assert.equal(r.status, 0);
      assert.match(r.stdout, /NEWLY AUTOMATED {2}e2e/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('T7 · the time-to-ship fact', () => {
  test('is {value, asOf, verify}, measured automation plus declared manual estimates', () => {
    const s = summarize([{ name: 'a', manual: false, result: 'pass', seconds: 1800 }, { name: 'b', manual: true, result: 'manual', seconds: 0, row: 'O-X', estimateMinutes: 90 }], { asOf: '2026-10-03', id: 'rehearsalfx' });
    assert.equal(s.automatedMinutes, 30);
    assert.equal(s.timeToShip.value, 2);
    assert.equal(s.timeToShip.asOf, '2026-10-03');
    assert.match(s.timeToShip.verify, /rehearse-app2\.mjs --id rehearsalfx/);
  });
});

describe('T8 · the real step register', () => {
  const decl = loadSteps(ROOT);
  test('every manual step names a row; every auto step names a command', () => {
    for (const s of decl.steps) {
      if (s.kind === 'manual') assert.match(String(s.row), /^O-[A-Z0-9-]+$/, `${s.name} names no row`);
      else assert.ok(Array.isArray(s.argv) || Array.isArray(s.argvs), `${s.name} names no command`);
    }
    for (const row of Object.values(decl.readoutRows)) assert.match(row, /^O-[A-Z0-9-]+$/);
    for (const [name, lane] of Object.entries(decl.readoutLanes ?? {})) {
      if (name.startsWith('_')) continue;
      assert.ok(existsSync(join(ROOT, lane)), `readoutLanes["${name}"] names ${lane}, which does not exist`);
    }
  });
  test('all seven targets and the extension template are exercised or listed with a reason', () => {
    const covered = new Set(decl.steps.flatMap((s) => s.targets ?? []));
    for (const t of ['web', 'android', 'ios', 'macos', 'windows', 'linux', 'apps-gov-in', 'extension']) assert.ok(covered.has(t), `${t} is in no step`);
    for (const u of decl.unexercised) assert.ok(u.why.length > 20, `${u.target} has no reason`);
  });
  test('no step reads a credential: the step environment carries none', async () => {
    const { stepEnv } = await import('../../kit/rehearse-app2.mjs');
    const env = stepEnv({ PATH: '/bin', PLAY_SERVICE_ACCOUNT_JSON: 'x', GITHUB_TOKEN: 'y', SUPABASE_SERVICE_ROLE_KEY: 'z' });
    assert.deepEqual(Object.keys(env), ['PATH']);
  });
});
