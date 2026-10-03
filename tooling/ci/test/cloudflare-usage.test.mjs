// ─────────────────────────────────────────────────────────────────────────────
// cloudflare-usage.test.mjs — tooling/ops/check-cloudflare-usage.mjs must go RED
// under 50% headroom, must say "could not look" (2) rather than green when it
// could not read, and its dated deferral must expire.
//
// PB-17, row O-LIVE-DUTY-RED-BLOCKS-THE-FIX-DEPLOY. No case reaches the network:
// every read is injected, or answered from tooling/ops/fixtures/cloudflare-usage.
//
// Run:  node --test tooling/ci/test/cloudflare-usage.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  METRICS,
  MIN_HEADROOM,
  judgeMetric,
  grade,
  readCeilings,
  usageFromGraphql,
  previousUtcDay,
  pendingDecision,
  readUsage,
} from '../../ops/check-cloudflare-usage.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'check-cloudflare-usage.mjs');
const FIXTURES = join(REPO, 'tooling', 'ops', 'fixtures', 'cloudflare-usage');
const env = (over = {}) => {
  const e = { ...process.env, ...over };
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete e[k];
  return e;
};
const cli = (args, over = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: env(over) });

describe('every graded metric names a REAL ceiling row', () => {
  test('each `ceiling` is a row of tooling/ceilings.json with a numeric value', () => {
    const rows = readCeilings(REPO);
    const graded = METRICS.filter((m) => m.ceiling !== null);
    assert.ok(graded.length >= 4, 'Workers, D1 writes, KV reads and KV writes are graded');
    for (const m of graded) {
      assert.ok(rows.has(m.ceiling), `${m.ceiling} is not a row of tooling/ceilings.json`);
      assert.equal(typeof rows.get(m.ceiling).value, 'number', `${m.ceiling} carries no numeric value`);
    }
  });
});

describe('judgeMetric — headroom under 50% is RED', () => {
  const m = { what: 'KV writes', ceiling: 'kv.writesPerDay' };
  const row = { value: 1000 };
  test('60% used (40% headroom) is RED', () => assert.equal(judgeMetric(m, 600, row).code, 1));
  test('exactly 50% used is not under 50% headroom', () => assert.equal(judgeMetric(m, 500, row).code, 0));
  test('40% used is green', () => assert.equal(judgeMetric(m, 400, row).code, 0));
  test('a metric with no number is COVERAGE LOST', () => assert.equal(judgeMetric(m, NaN, row).code, 2));
  test('an unverified (null) ceiling is printed, never graded', () => {
    const r = judgeMetric(m, 999999, { value: null });
    assert.equal(r.code, 0);
    assert.match(r.line, /not graded/);
  });
  test('MIN_HEADROOM is one half', () => assert.equal(MIN_HEADROOM, 0.5));
});

describe('grade', () => {
  const ceilings = () => readCeilings(REPO);
  test('a missing ceiling row is COVERAGE LOST, not a skip', () => {
    const c = ceilings();
    c.delete('kv.writesPerDay');
    assert.equal(grade({ workers: {}, d1: {}, kv: {} }, c).code, 2);
  });
  test('a deferred read (null) prints every metric as unreadable and judges nothing', () => {
    const r = grade(null, ceilings());
    assert.equal(r.code, 0);
    assert.ok(r.lines.every((l) => /unreadable/.test(l)));
  });
  test('Workers invocations are summed across scripts', () => {
    const r = grade({ workers: { a: 30000, b: 30000 }, d1: {}, kv: {} }, ceilings());
    assert.equal(r.code, 1, 'two scripts at 30% each are 60% of the account ceiling');
  });
});

describe('the GraphQL answer', () => {
  test('is folded per script, per action', () => {
    const u = usageFromGraphql({
      data: {
        viewer: {
          accounts: [
            {
              workersInvocationsAdaptive: [
                { sum: { requests: 5 }, dimensions: { scriptName: 'platform' } },
                { sum: { requests: 7 }, dimensions: { scriptName: 'platform' } },
              ],
              d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 10, rowsWritten: 3 } }],
              kvOperationsAdaptiveGroups: [
                { sum: { requests: 4 }, dimensions: { actionType: 'read' } },
                { sum: { requests: 2 }, dimensions: { actionType: 'write' } },
              ],
            },
          ],
        },
      },
    });
    assert.deepEqual(u, { workers: { platform: 12 }, d1: { rowsRead: 10, rowsWritten: 3 }, kv: { read: 4, write: 2 } });
  });
  test('GraphQL errors, or no account, are COULD NOT LOOK', () => {
    assert.throws(() => usageFromGraphql({ errors: [{ message: 'not authorized' }] }), /not authorized/);
    assert.throws(() => usageFromGraphql({ data: { viewer: { accounts: [] } } }), /0 account/);
  });
  test('the window is the previous whole UTC day', () => {
    assert.deepEqual(previousUtcDay(Date.parse('2026-10-01T15:00:00Z')), {
      date: '2026-09-30',
      start: '2026-09-30T00:00:00.000Z',
      end: '2026-10-01T00:00:00.000Z',
    });
  });
  test('no token is COULD NOT LOOK and sends nothing', async () => {
    await assert.rejects(() => readUsage({ fetchImpl: async () => assert.fail('no request without a token'), env: {} }), /CLOUDFLARE_API_TOKEN/);
  });
  test('a non-200 is COULD NOT LOOK', async () => {
    const fetchImpl = async () => ({ status: 403, json: async () => ({}) });
    await assert.rejects(() => readUsage({ fetchImpl, env: { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' } }), /403/);
  });
});

describe('the dated deferral (#1095\'s pattern)', () => {
  const at = Date.parse('2026-10-01T12:00:00Z');
  test('no token, before the date: deferred', () => {
    assert.equal(pendingDecision('2026-10-21', { tokenPresent: false, fixture: false, nowMs: at }).deferred, true);
  });
  test('no token, after the date: COVERAGE LOST naming the secret', () => {
    const d = pendingDecision('2026-10-21', { tokenPresent: false, fixture: false, nowMs: Date.parse('2026-10-22T00:00:01Z') });
    assert.equal(d.deferred, false);
    assert.match(d.lost, /CLOUDFLARE_READ_TOKEN/);
  });
  test('a token present defers nothing', () => {
    const d = pendingDecision('2026-10-21', { tokenPresent: true, fixture: false, nowMs: at });
    assert.equal(d.deferred, false);
    assert.match(d.note, /defers nothing/);
  });
  test('a date that is not a date is COVERAGE LOST', () => {
    assert.match(pendingDecision('soon', { tokenPresent: false, fixture: false, nowMs: at }).lost, /not a YYYY-MM-DD/);
  });
  test('ops-watch.yml dates the deferral 2026-10-21, matching #1095\'s', async () => {
    const { readFileSync } = await import('node:fs');
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    assert.match(wf, /check-cloudflare-usage\.mjs --cloudflare-read-pending-until 2026-10-21/);
  });
});

describe('the CLI (the red control)', () => {
  test('GREEN control: every metric at 40% → exit 0', () => {
    const r = cli(['--usage-file', join(FIXTURES, 'at-40-percent.json')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
  test('RED control: a usage at 60% of a ceiling → exit 1', () => {
    const r = cli(['--usage-file', join(FIXTURES, 'at-60-percent.json')]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /KV writes: 600 of 1000 \(kv\.writesPerDay\) — headroom 40%, under 50%/);
  });
  test('no token and no deferral → exit 2', () => {
    const r = cli([], { CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined });
    assert.equal(r.status, 2, r.stdout + r.stderr);
  });
});
