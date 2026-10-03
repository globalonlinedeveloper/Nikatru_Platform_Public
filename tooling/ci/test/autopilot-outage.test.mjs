// autopilot-outage.test.mjs — a laptop outage reads as DEGRADED, not red
// (lane autopilot-outage, row O-LAPTOP-OUTAGE-READS-AS-RED).
//
// Drives assert-ops-register.mjs's own record-query limb (`evaluateRunRecords`) with the
// heartbeat state `laptopState` produces, so the rule is tested where it grades:
//   (a) fresh beat + stale backup                       → red, as today
//   (b) beat stale 2 h + backup 10 h past its window    → degraded, nothing blocks
//   (c) beat stale 80 h                                 → the backup red, the other laptop rows degraded
//   (d) unknown beat                                    → red
//   (e) a non-laptop row stale during an outage         → red
//   (f) a backup stale since BEFORE the outage began    → red
// plus the `outage` home every scheduled laptop row must carry (mutating the REAL
// register), and the Measure-first answer: an ops-watch red caused only by laptop rows
// does not reach ci.yml's guard through duty.workflow.ops-watch.yml.
//
// Run:  node --test "tooling/ci/test/autopilot-outage.test.mjs"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRunRecords, checkLaptopOutageHomes } from '../assert-ops-register.mjs';
import { laptopState, parseBeat, outageGrade } from '../../autopilot/heartbeat.mjs';
import { parseWorkflow } from '../workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTER = JSON.parse(readFileSync(join(ROOT, 'tooling/ops/register.json'), 'utf8'));
const NOW = Date.parse('2026-10-02T12:00:00Z');
const H = 3_600_000;
const BACKUP = 'duty.laptop.nikatru-daily-backup';
const WATCHDOG = 'duty.laptop.nikatru-watchdog';

const duty = (id, cadence, extra = {}) => ({
  id,
  kind: 'duty',
  what: 'w',
  detector: 'd',
  response: 'r',
  cadence,
  mechanism: { substrate: 'claude-scheduled-task', anchor: 'renovate.json', record: 'r', failingValue: 'f', readBy: 'b', recordQuery: { reader: 'glitchtip-heartbeat', org: 'o', monitor: 1, ...extra } },
});
const reg = () => ({
  _recordReaders: { _maxUnreachable: 1, _maxUnreadable: 4, _windowMultiplier: 1.5, 'glitchtip-heartbeat': { queries: 'checks', needs: 'GLITCHTIP_TOKEN' } },
  rows: [duty(BACKUP, '8h'), duty(WATCHDOG, '1h'), duty('duty.workflow.other.yml', '1d')],
});
const lastOk = (o) => new Map(Object.entries(o).map(([id, agoH]) => [id, { lastSuccessMs: NOW - agoH * H, detail: 'd' }]));
const beatAgo = (agoH, mode = 'primary') => laptopState(parseBeat(JSON.stringify({ v: 1, at: new Date(NOW - agoH * H).toISOString(), seq: 3, mode, host: 'laptop' })), NOW);
const ids = (r) => r.live.map((v) => v.id).sort();

describe('the outage rule, graded by the record-query limb', () => {
  test('(a) 🔴 a FRESH beat + a stale backup → red, exactly as today', () => {
    const r = evaluateRunRecords(reg(), lastOk({ [BACKUP]: 30, [WATCHDOG]: 0.5, 'duty.workflow.other.yml': 1 }), NOW, beatAgo(5 / 60));
    assert.deepEqual(ids(r), [BACKUP]);
    assert.deepEqual(r.degraded, []);
  });
  test('(b) a beat stale 2 h + a backup 10 h past its window → DEGRADED, nothing blocks', () => {
    // window = 8 h × 1.5 = 12 h; newest success 22 h ago → stale since 10 h ago = at − one cadence.
    const r = evaluateRunRecords(reg(), lastOk({ [BACKUP]: 22, [WATCHDOG]: 0.5, 'duty.workflow.other.yml': 1 }), NOW, beatAgo(2));
    assert.deepEqual(r.live, [], 'not a problem: the run’s exit is unchanged by it');
    assert.deepEqual(r.errors, []);
    assert.equal(r.degraded.length, 1);
    assert.match(r.degraded[0], /^laptop off since 2026-10-02T10:00:00\.000Z \(2\.0 h\): duty\.laptop\.nikatru-daily-backup degraded$/);
    assert.ok(r.prints.some((p) => /degraded=1/.test(p)), 'the tally names it');
  });
  test('(b′) handover is positive evidence too; drill-stale is NOT (a drill changes no grading)', () => {
    const probes = lastOk({ [BACKUP]: 22, [WATCHDOG]: 0.5, 'duty.workflow.other.yml': 1 });
    assert.deepEqual(ids(evaluateRunRecords(reg(), probes, NOW, beatAgo(2, 'handover'))), []);
    assert.deepEqual(ids(evaluateRunRecords(reg(), probes, NOW, beatAgo(2, 'drill'))), [BACKUP]);
  });
  test('(c) 🔴 a beat stale 80 h → the backup is RED again (past DEGRADED_MAX_H); the watchdog stays degraded', () => {
    const r = evaluateRunRecords(reg(), lastOk({ [BACKUP]: 81, [WATCHDOG]: 81, 'duty.workflow.other.yml': 1 }), NOW, beatAgo(80));
    assert.deepEqual(ids(r), [BACKUP]);
    assert.equal(r.degraded.length, 1);
    assert.match(r.degraded[0], /nikatru-watchdog degraded/);
  });
  test('(d) 🔴 an unknown beat (missing, garbled, from the future) → red, byte for byte as with no beat at all', () => {
    const probes = lastOk({ [BACKUP]: 22, [WATCHDOG]: 0.5, 'duty.workflow.other.yml': 1 });
    const today = evaluateRunRecords(reg(), probes, NOW);
    for (const unknown of [laptopState(null, NOW), laptopState(parseBeat('{"v":1'), NOW), beatAgo(-1)]) {
      assert.equal(unknown.state, 'unknown');
      const r = evaluateRunRecords(reg(), probes, NOW, unknown);
      assert.deepEqual({ ...r, degraded: undefined }, { ...today, degraded: undefined });
      assert.deepEqual(ids(r), [BACKUP]);
    }
  });
  test('(e) 🔴 a NON-laptop row stale during an outage → red', () => {
    const r = evaluateRunRecords(reg(), lastOk({ [BACKUP]: 1, [WATCHDOG]: 0.5, 'duty.workflow.other.yml': 50 }), NOW, beatAgo(2));
    assert.deepEqual(ids(r), ['duty.workflow.other.yml']);
    assert.deepEqual(r.degraded, []);
  });
  test('(f) 🔴 a backup stale since BEFORE the outage began → red: the outage does not excuse an older failure', () => {
    // newest success 40 h ago → stale since 28 h ago, before at − cadence (10 h ago).
    const r = evaluateRunRecords(reg(), lastOk({ [BACKUP]: 40, [WATCHDOG]: 0.5, 'duty.workflow.other.yml': 1 }), NOW, beatAgo(2));
    assert.deepEqual(ids(r), [BACKUP]);
    assert.deepEqual(r.degraded, []);
  });
  test('🔴 no success at all, a held failure, or a missing mechanism stays red during an outage', () => {
    const held = reg();
    held.rows[0].mechanism.recordQuery.lastObserved = { verdict: 'fail', at: '2026-10-01', detail: 'x' };
    assert.deepEqual(ids(evaluateRunRecords(held, lastOk({ [BACKUP]: 22, [WATCHDOG]: 0.5, 'duty.workflow.other.yml': 1 }), NOW, beatAgo(2))), [BACKUP]);
    const nan = new Map([[BACKUP, { lastSuccessMs: NaN, detail: 'none' }], [WATCHDOG, { lastSuccessMs: NOW, detail: 'd' }], ['duty.workflow.other.yml', { lastSuccessMs: NOW, detail: 'd' }]]);
    assert.deepEqual(ids(evaluateRunRecords(reg(), nan, NOW, beatAgo(2))), [BACKUP]);
    const gone = new Map([[BACKUP, { missing: true, why: '404' }], [WATCHDOG, { lastSuccessMs: NOW, detail: 'd' }], ['duty.workflow.other.yml', { lastSuccessMs: NOW, detail: 'd' }]]);
    assert.deepEqual(ids(evaluateRunRecords(reg(), gone, NOW, beatAgo(2))), [BACKUP]);
  });
  test('outageGrade refuses every non-laptop id and every non-outage state on its own', () => {
    const base = { cadenceMs: 8 * H, windowMs: 12 * H, lastSuccessMs: NOW - 22 * H, nowMs: NOW };
    assert.equal(outageGrade({ ...base, rowId: BACKUP, laptop: beatAgo(2) }).degraded, true);
    assert.equal(outageGrade({ ...base, rowId: 'duty.workflow.x', laptop: beatAgo(2) }).degraded, false);
    for (const s of [beatAgo(0.1), beatAgo(2, 'drill'), laptopState(null, NOW)]) assert.equal(outageGrade({ ...base, rowId: BACKUP, laptop: s }).degraded, false, s.state);
  });
});

describe('every scheduled laptop duty names its outage home', () => {
  test('the real register is clean, and names all four homes', () => {
    const r = checkLaptopOutageHomes(REGISTER);
    assert.deepEqual(r.errors, []);
    const named = r.prints.map((p) => /— (duty\.laptop\.[^:]+):/.exec(p)?.[1]).sort();
    assert.deepEqual(named, ['duty.laptop.nikatru-daily-backup', 'duty.laptop.nikatru-ops-check', 'duty.laptop.nikatru-pipeline-driver', 'duty.laptop.nikatru-watchdog']);
  });
  test('🔴 the REAL register with one row’s `outage` removed (or emptied) fails the guard', () => {
    const cut = structuredClone(REGISTER);
    delete cut.rows.find((r) => r.id === WATCHDOG).outage;
    assert.match(checkLaptopOutageHomes(cut).errors.join('\n'), /duty\.laptop\.nikatru-watchdog: a scheduled laptop duty with no `outage/);
    const empty = structuredClone(REGISTER);
    empty.rows.find((r) => r.id === BACKUP).outage.cloudTwin = '';
    assert.equal(checkLaptopOutageHomes(empty).errors.length, 1);
  });
  test('an on-demand (attended) laptop row needs none', () => {
    const r = checkLaptopOutageHomes({ rows: [{ id: 'duty.laptop.x', kind: 'duty', cadence: 'on-demand' }] });
    assert.deepEqual(r.errors, []);
  });
});

describe('Measure-first: an ops-watch red caused only by laptop rows does not reach ci.yml', () => {
  /** The jobs of ops-watch.yml that run assert-ops-register (where a laptop row turns red),
   *  and whether any of them is in duty.workflow.ops-watch.yml's unit (what ci.yml grades). */
  const chain = (reg, wf) => {
    const hosts = [...wf.jobs.values()].filter((j) => j.lines.some((l) => /node\s+tooling\/ci\/assert-ops-register\.mjs/.test(l.text) && !/out="\$\(/.test(l.text))).map((j) => j.name);
    const unit = reg.rows.find((r) => r.id === 'duty.workflow.ops-watch.yml').mechanism.recordQuery.unit.jobs;
    return { hosts, reaches: hosts.filter((h) => unit.includes(h)) };
  };
  const WF = parseWorkflow(ROOT, '.github/workflows/ops-watch.yml');
  test('the guard runs in ops-watch’s `heartbeats` job, which is NOT in the row’s unit: the chain does not exist', () => {
    const c = chain(REGISTER, WF);
    assert.deepEqual(c.hosts, ['heartbeats'], 'COVERAGE LOST if the guard moved: re-measure item 4');
    assert.deepEqual(c.reaches, []);
  });
  test('🔴 red control: put `heartbeats` in the unit and the chain exists (item 4 would then be needed)', () => {
    const cut = structuredClone(REGISTER);
    cut.rows.find((r) => r.id === 'duty.workflow.ops-watch.yml').mechanism.recordQuery.unit.jobs.push('heartbeats');
    assert.deepEqual(chain(cut, WF).reaches, ['heartbeats']);
  });
});
