// osv-scan-due.test.mjs — tooling/ops/osv-scan-due.mjs decides whether ops-watch scans main
// with OSV on this run (#1095 review finding 5). Red controls: a graded scan inside 20 h is not
// due; a skipped or cancelled step graded nothing; the current run is never its own evidence;
// past 36 h it warns; an unreadable history FAILS OPEN, towards scanning.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, newestGradedScan, SCAN_STEP, DUE_HOURS, STALE_HOURS } from '../../ops/osv-scan-due.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, '..', '..', 'ops', 'osv-scan-due.mjs');
const NOW = Date.parse('2026-10-02T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();

/** A fake GitHub: `runs` newest first, each { id, conclusion } for the scan step (or null for no step). */
function fakeFetch(runs, { failJobsFor = null } = {}) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/actions\/workflows\/ops-watch\.yml\/runs/.test(url)) return ok({ workflow_runs: runs.map((r) => ({ id: r.id, updated_at: r.at })) });
    const m = url.match(/\/actions\/runs\/(\d+)\/jobs/);
    if (m) {
      if (String(failJobsFor) === m[1]) return new Response('{}', { status: 502 });
      const r = runs.find((x) => String(x.id) === m[1]);
      const steps = r.conclusion === null ? [{ name: 'Something else', conclusion: 'success' }] : [{ name: SCAN_STEP, conclusion: r.conclusion, completed_at: r.at }];
      return ok({ jobs: [{ name: 'Every declared duty is fresh', completed_at: r.at, steps }] });
    }
    return new Response('{}', { status: 404 });
  };
  f.calls = calls;
  return f;
}
const read = (runs, extra = {}) => newestGradedScan({ fetchImpl: fakeFetch(runs, extra), repo: 'o/r', token: 't', currentRunId: extra.currentRunId ?? null });

describe('osv-scan-due — the decision', () => {
  it(`a graded scan under ${DUE_HOURS} h ago is not due; over it is due; past ${STALE_HOURS} h it is stale too`, () => {
    assert.equal(decide({ runId: 1, at: hoursAgo(5) }, NOW).due, false);
    const due = decide({ runId: 1, at: hoursAgo(DUE_HOURS + 1) }, NOW);
    assert.deepEqual([due.due, due.stale], [true, false]);
    const stale = decide({ runId: 1, at: hoursAgo(STALE_HOURS + 1) }, NOW);
    assert.deepEqual([stale.due, stale.stale], [true, true]);
    assert.deepEqual([decide(null, NOW).due, decide(null, NOW).stale], [true, true]);
  });
});

describe('osv-scan-due — reading the history', () => {
  it('🔴 a SKIPPED or cancelled scan step graded nothing: the older graded one is the evidence', async () => {
    const n = await read([{ id: 3, conclusion: 'skipped', at: hoursAgo(1) }, { id: 2, conclusion: 'cancelled', at: hoursAgo(2) }, { id: 1, conclusion: 'success', at: hoursAgo(30) }]);
    assert.equal(n.runId, 1);
    assert.equal(decide(n, NOW).due, true);
  });
  it('a FAILED scan graded main (it found an advisory or could not look, and paged): it counts', async () => {
    const n = await read([{ id: 2, conclusion: 'failure', at: hoursAgo(3) }, { id: 1, conclusion: 'success', at: hoursAgo(30) }]);
    assert.equal(n.runId, 2);
    assert.equal(decide(n, NOW).due, false);
  });
  it('🔴 the current run is never its own evidence, and a run with no scan step is passed over', async () => {
    const n = await read([{ id: 9, conclusion: 'success', at: hoursAgo(0) }, { id: 8, conclusion: null, at: hoursAgo(1) }, { id: 7, conclusion: 'success', at: hoursAgo(25) }], { currentRunId: 9 });
    assert.equal(n.runId, 7);
  });
  it('no graded scan in the window is null (due, and stale)', async () => {
    assert.equal(await read([{ id: 1, conclusion: 'skipped', at: hoursAgo(1) }]), null);
  });
  it('🔴 a non-200 throws: an unread history is never "no scan needed"', async () => {
    await assert.rejects(read([{ id: 1, conclusion: 'success', at: hoursAgo(1) }], { failJobsFor: 1 }), /HTTP 502/);
  });
});

describe('osv-scan-due — the CLI fails open, towards scanning', () => {
  it('🔴 with no token it writes due=true and says why, exit 0', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'osv-due-')), 'out.txt');
    const env = { ...process.env, GITHUB_OUTPUT: out };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    const r = spawnSync(process.execPath, [TOOL], { encoding: 'utf8', env, timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /due=true — the scan history could not be read \(no GH_TOKEN/);
    assert.equal(readFileSync(out, 'utf8'), 'due=true\n');
  });
});
