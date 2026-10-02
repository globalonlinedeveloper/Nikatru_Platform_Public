// autopilot-ledger.test.mjs — the autopilot watch's decisions (tooling/autopilot/ledger.mjs),
// one watch pass against a fake GitHub (tooling/autopilot/watch.mjs), and the workflow
// shell (.github/workflows/autopilot-watch.yml). Lane autopilot-watch,
// row O-WATCH-RUNS-ON-THE-LAPTOP.
//
// Run:  node --test "tooling/ci/test/autopilot-ledger.test.mjs"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laptopIssueAction, boardRow, runLedger, renderLedger, assertPublic, e2eDecision, requestBudget, parseBoardCache, boardPlan, jobReadIds, UNREAD, LAPTOP_OFF_TITLE } from '../../autopilot/ledger.mjs';
import { pass } from '../../autopilot/watch.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WF = readFileSync(join(ROOT, '.github/workflows/autopilot-watch.yml'), 'utf8');
const NOW = Date.parse('2026-10-02T12:00:00Z');
const H = 3_600_000;
const iso = (agoH) => new Date(NOW - agoH * H).toISOString();
const beat = (agoH, mode = 'primary') => ({ v: 1, at: iso(agoH), seq: 4, mode, host: 'laptop' });
const HEAD = 'c'.repeat(40);
const gate = (run, conclusion) => ({ name: 'ci-gate', status: 'completed', conclusion, details_url: `https://github.com/o/r/actions/runs/${run}/job/1` });
const ciRun = (id, conclusion = 'success') => ({ id, path: '.github/workflows/ci.yml', status: 'completed', conclusion, head_sha: HEAD });

describe('(a) the laptop-off issue opens and closes only on a transition', () => {
  test('🔴 three stale passes → ONE open, then edits', () => {
    let open = null;
    const acts = [];
    for (let i = 0; i < 3; i++) {
      const a = laptopIssueAction({ state: 'stale', beat: beat(1 + i), open, now: NOW });
      acts.push(a.act);
      if (a.act === 'open') open = { number: 5 };
    }
    assert.deepEqual(acts, ['open', 'edit', 'edit']);
  });
  test('🔴 unknown changes nothing, open or not; fresh closes an open one and leaves none alone', () => {
    assert.equal(laptopIssueAction({ state: 'unknown', beat: null, open: { number: 5 }, now: NOW }).act, 'none');
    assert.equal(laptopIssueAction({ state: 'unknown', beat: null, open: null, now: NOW }).act, 'none');
    assert.equal(laptopIssueAction({ state: 'fresh', beat: beat(0.1), open: { number: 5 }, now: NOW }).act, 'close');
    assert.equal(laptopIssueAction({ state: 'fresh', beat: beat(0.1), open: null, now: NOW }).act, 'none');
  });
  test('handover opens it; drill-stale opens it titled [DRILL]', () => {
    assert.equal(laptopIssueAction({ state: 'handover', beat: beat(0, 'handover'), open: null, now: NOW }).title, LAPTOP_OFF_TITLE);
    assert.equal(laptopIssueAction({ state: 'drill-stale', beat: beat(1, 'drill'), open: null, now: NOW }).title, `[DRILL] ${LAPTOP_OFF_TITLE}`);
  });
});

describe('(b) the PR board', () => {
  test('🔴 the NEWEST run decides: an old green gate and a new red one → RED', () => {
    const r = boardRow({ number: 3, labels: [], createdAt: iso(1), checks: [gate(100, 'success'), gate(200, 'failure')], runs: [ciRun(100), ciRun(200, 'failure')] }, NOW);
    assert.equal(r.gate, 'RED');
    const g = boardRow({ number: 3, labels: [], createdAt: iso(1), checks: [gate(100, 'success')], runs: [ciRun(100), { ...ciRun(200), status: 'in_progress', conclusion: null }] }, NOW);
    assert.notEqual(g.gate, 'GREEN', 'an old green while a newer run is going is not green');
  });
  test('STALL: open > 6 h, green, ready, no land-ok — and only then', () => {
    const base = { number: 3, labels: ['needs-review'], createdAt: iso(7), checks: [gate(100, 'success')], runs: [ciRun(100)] };
    assert.equal(boardRow(base, NOW).stall, true);
    assert.equal(boardRow({ ...base, labels: ['land-ok'] }, NOW).stall, false);
    assert.equal(boardRow({ ...base, draft: true }, NOW).stall, false);
    assert.equal(boardRow({ ...base, createdAt: iso(5) }, NOW).stall, false);
    assert.deepEqual(boardRow({ ...base, labels: ['needs-review', 'bug'] }, NOW).labels, ['needs-review'], 'only autopilot labels are shown');
  });
});

describe('(c) the run ledger', () => {
  const run = (id, over = {}) => ({ id, name: 'CI', workflow_id: 1, head_branch: 'feat/x', head_sha: HEAD, status: 'completed', conclusion: 'failure', created_at: iso(2), updated_at: iso(1), ...over });
  test('🔴 a superseded cancel is attributed to the newer run; an unexplained one says so', () => {
    const rows = runLedger({ runs: [run(10, { conclusion: 'cancelled' }), run(11, { conclusion: 'success' }), run(20, { conclusion: 'cancelled', head_sha: 'd'.repeat(40) })], now: NOW });
    assert.equal(rows.find((r) => r.id === 10).cause, 'superseded by #11');
    assert.equal(rows.find((r) => r.id === 20).cause, 'cancelled, no reason recorded');
  });
  test('a failure names its first failed job and step; owner is main or the PR', () => {
    const rows = runLedger({ runs: [run(30), run(31, { head_branch: 'main' })], jobs: { 30: [{ name: 'ok', conclusion: 'success' }, { name: 'guard-meta', conclusion: 'failure', steps: [{ name: 'checkout', conclusion: 'success' }, { name: 'ops register', conclusion: 'failure' }] }] }, prByBranch: { 'feat/x': 77 }, now: NOW });
    assert.equal(rows.find((r) => r.id === 30).cause, 'guard-meta › ops register');
    assert.equal(rows.find((r) => r.id === 30).owner, '#77');
    assert.equal(rows.find((r) => r.id === 31).owner, 'main');
    assert.match(rows.find((r) => r.id === 31).cause, /jobs not read/);
  });
  test('🔴 attended workflows are flagged; green runs and runs older than 12 h are not listed', () => {
    const rows = runLedger({ runs: [run(40, { name: 'Rollback' }), run(41, { name: 'Store submit: Google Play' }), run(42, { name: 'Native auth proof' }), run(43, { conclusion: 'success' }), run(44, { updated_at: iso(13) }), run(45, { conclusion: 'timed_out' }), run(46, { conclusion: 'startup_failure' })], now: NOW });
    assert.deepEqual(rows.filter((r) => r.attended).map((r) => r.id).sort(), [40, 41, 42]);
    assert.deepEqual(rows.map((r) => r.id).sort(), [40, 41, 42, 45, 46]);
  });
  test('🔴 truncation drops the OLDEST rows first', () => {
    const ledger = runLedger({ runs: Array.from({ length: 50 }, (_, i) => run(100 + i, { updated_at: new Date(NOW - (50 - i) * 60_000).toISOString(), name: `CI ${'x'.repeat(40)}` })), now: NOW });
    const body = renderLedger({ now: NOW, laptop: { state: 'fresh', beat: null }, board: [], ledger, freeze: null, cap: 4000 });
    assert.ok(body.length <= 4000, `${body.length}`);
    assert.match(body, /\| 149 \|/, 'the newest row survives');
    assert.doesNotMatch(body, /\| 100 \|/, 'the oldest row is dropped');
    assert.match(body, /older row\(s\) dropped/);
  });
  test('🔴 a fork branch name is escaped and stripped of `@` in the owner cell (no broken row, no ping)', () => {
    const ledger = runLedger({ runs: [run(61, { head_branch: 'x|y @someone' })], now: NOW });
    assert.equal(ledger[0].owner, 'branch x\\|y someone');
    const body = renderLedger({ now: NOW, laptop: { state: 'fresh', beat: null }, board: [], ledger, freeze: null });
    assert.doesNotMatch(body, /@someone/);
    assert.equal(body.split('\n').find((l) => l.startsWith('| 61 ')).split(/(?<!\\)\|/).length, 8, 'six cells, the pipe escaped');
  });
  test('🔴 a cell escapes backslashes before pipes, so a trailing backslash cannot break the table (CodeQL 581)', () => {
    const ledger = runLedger({ runs: [run(60, { name: 'CI \\|x' })], now: NOW });
    const body = renderLedger({ now: NOW, laptop: { state: 'fresh', beat: null }, board: [], ledger, freeze: null });
    assert.match(body, /\| 60 \| CI \\\\\\\|x \|/);
  });
  test('🔴 a body with a C:/Users path or a secret-shaped string is refused', () => {
    assert.match(assertPublic('see C:\\Users\\owner\\x'), /C:\/Users/);
    assert.match(assertPublic(`token ${['ghp', 'Q7'.repeat(18)].join('_')}`), /secret-shaped/);
    assert.equal(assertPublic('| 1 | CI | main |'), null);
  });
});

describe('E2E after a web deploy', () => {
  const base = { deployedSha: 'a'.repeat(40), provenSha: 'b'.repeat(40), files: ['apps/subscriptiontracker/lib/main.dart'], lastDispatchAt: NaN, hold: false, now: NOW };
  test('an app diff → a dispatch', () => assert.equal(e2eDecision(base).dispatch, true));
  test('🔴 a docs-only diff → none', () => assert.equal(e2eDecision({ ...base, files: ['docs/x.md', 'tooling/ci/y.mjs'] }).dispatch, false));
  test('🔴 a dispatch within 30 min → none; at 31 min → a dispatch', () => {
    assert.equal(e2eDecision({ ...base, lastDispatchAt: NOW - 10 * 60_000 }).dispatch, false);
    assert.equal(e2eDecision({ ...base, lastDispatchAt: NOW - 31 * 60_000 }).dispatch, true);
  });
  test('🔴 an open e2e-hold → none', () => assert.equal(e2eDecision({ ...base, hold: true }).dispatch, false));
  test('🔴 the deployed head already proven → none; an unreadable diff → a dispatch (assume app)', () => {
    assert.equal(e2eDecision({ ...base, provenSha: base.deployedSha }).dispatch, false);
    assert.equal(e2eDecision({ ...base, files: null }).dispatch, true);
    assert.equal(e2eDecision({ ...base, files: ['packages/design_system/pubspec.yaml'] }).dispatch, true, 'a shared UI package');
  });
});

describe('the request budget (review of #1171, finding 4)', () => {
  test('🔴 REQUEST_CEILING: 80 requests pass, the 81st is refused', () => {
    const b = requestBudget();
    assert.equal(b.ceiling, 80);
    for (let i = 0; i < 80; i++) b.take(`r${i}`);
    assert.throws(() => b.take('one more'), /REQUEST CEILING: one more would be request 81 of one pass, over 80/);
    assert.equal(b.used(), 80);
  });
  test('🔴 jobs are read for at most JOB_READS_PER_PASS (5) failed runs, newest first', () => {
    const runs = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, status: 'completed', conclusion: i % 3 ? 'failure' : 'cancelled', updated_at: iso(30 - i) }));
    const ids = jobReadIds(runs);
    assert.equal(ids.length, 5);
    assert.deepEqual(ids, ['30', '29', '27', '26', '24']);
  });
  test('🔴 the board cache: a head unchanged with a GREEN/RED younger than BOARD_CACHE_MIN is reused; a moved head, a stale or non-terminal entry, is read', () => {
    const A = 'a'.repeat(40);
    const B = 'b'.repeat(40);
    const body = renderLedger({ now: NOW, laptop: { state: 'fresh', beat: null }, ledger: [], freeze: null, board: [boardRow({ number: 1, labels: [], createdAt: iso(1), headSha: A, gate: 'GREEN' }, NOW), boardRow({ number: 2, labels: [], createdAt: iso(1), headSha: A, gate: 'PENDING' }, NOW), boardRow({ number: 3, labels: [], createdAt: iso(1), headSha: A, gate: 'RED', readAt: NOW - 61 * 60_000 }, NOW)] });
    const cache = parseBoardCache(body);
    assert.deepEqual([...cache.keys()], [1, 3], 'only terminal verdicts are cached');
    const plan = boardPlan({ prs: [{ number: 1, headSha: A }, { number: 2, headSha: A }, { number: 3, headSha: A }, { number: 4, headSha: A }], cache, now: NOW });
    assert.deepEqual(plan.get(1), { gate: 'GREEN', at: NOW });
    assert.deepEqual(plan.get(2), { read: true });
    assert.deepEqual(plan.get(3), { read: true }, 'older than BOARD_CACHE_MIN: a re-run can turn it');
    assert.deepEqual(plan.get(4), { read: true });
    assert.deepEqual(boardPlan({ prs: [{ number: 1, headSha: B }], cache, now: NOW }).get(1), { read: true }, 'a moved head is read');
    assert.equal(parseBoardCache('<!-- autopilot board-cache {"1":["../x","GREEN",1]} -->').size, 0, 'off-shape entries are dropped');
    assert.equal(parseBoardCache('<!-- autopilot board-cache {not json -->').size, 0);
  });
  test('🔴 at most BOARD_READS_PER_PASS (25) PRs are read; the rest show UNREAD', () => {
    const prs = Array.from({ length: 30 }, (_, i) => ({ number: i + 1, headSha: 'a'.repeat(40) }));
    const plan = boardPlan({ prs, cache: new Map(), now: NOW });
    assert.equal([...plan.values()].filter((p) => p.read).length, 25);
    assert.equal(plan.get(30).gate, UNREAD);
  });
});

describe('one watch pass against a fake GitHub', () => {
  const fake = (world) => {
    const writes = [];
    const call = async (method, path, body) => {
      if (method !== 'GET') {
        writes.push({ method, path, body });
        return { ok: true, status: 200, json: { number: 9 }, text: '' };
      }
      const hit = Object.entries(world).find(([k]) => path.startsWith(k));
      return hit ? { ok: true, status: 200, json: hit[1], text: '' } : { ok: false, status: 404, json: null, text: '' };
    };
    return { call, writes };
  };
  const world = (extra = {}) => ({ '/issues?labels=laptop-off': [], '/pulls?state=open': [], '/actions/runs?created': { workflow_runs: [] }, '/issues?labels=land-freeze': [], '/issues?state=open': [], ...extra });
  const noBeat = async () => ({ ok: false, status: 404 });
  test('🔴 40 open PRs and 60 red runs stay under REQUEST_CEILING; a second pass on the same heads reads NO check-runs', async () => {
    const prs = Array.from({ length: 40 }, (_, i) => ({ number: 100 + i, draft: false, labels: [], created_at: iso(1), head: { sha: HEAD, ref: `feat/${i}`, repo: { full_name: 'o/r' } } }));
    const red = Array.from({ length: 60 }, (_, i) => ({ id: 1000 + i, name: 'CI', workflow_id: 1, head_branch: 'main', head_sha: HEAD, status: 'completed', conclusion: 'failure', updated_at: iso(1) }));
    const w = world({ '/pulls?state=open': prs, '/actions/runs?created': { workflow_runs: red }, '/commits/': { check_runs: [gate(100, 'success')] }, '/actions/runs?head_sha': { workflow_runs: [ciRun(100)] }, '/actions/runs/': { jobs: [] } });
    const reads = (f) => f.gets.filter((g) => g.startsWith('/commits/')).length;
    const counting = (wld) => {
      const f = fake(wld);
      f.gets = [];
      const inner = f.call;
      f.call = async (m, p, b) => {
        if (m === 'GET') f.gets.push(p);
        return inner(m, p, b);
      };
      return f;
    };
    const f1 = counting(w);
    const b1 = requestBudget();
    const r1 = await pass({ call: f1.call, repo: 'o/r', token: null, now: NOW, fetchImpl: noBeat, budget: b1 });
    assert.equal(r1.code, 0, r1.lines.join('\n'));
    assert.ok(b1.used() <= 80, `${b1.used()} requests`);
    assert.equal(reads(f1), 25, 'BOARD_READS_PER_PASS');
    assert.equal(f1.gets.filter((g) => /^\/actions\/runs\/\d+\/jobs/.test(g)).length, 5, 'JOB_READS_PER_PASS');
    const f2 = counting({ ...w, '/issues?state=open': [{ number: 12, title: 'Autopilot ledger', body: f1.writes.at(-1).body.body }] });
    const b2 = requestBudget();
    await pass({ call: f2.call, repo: 'o/r', token: null, now: NOW + 60_000, fetchImpl: noBeat, budget: b2 });
    assert.equal(reads(f2), 15, 'only the 15 left UNREAD last pass are read; the 25 cached GREEN are reused');
    assert.ok(b2.used() < b1.used(), `${b2.used()} < ${b1.used()}`);
  });
  test('🔴 a pass that would exceed the ceiling throws before sending, so nothing past it is written', async () => {
    const f = fake(world());
    await assert.rejects(pass({ call: f.call, repo: 'o/r', token: null, now: NOW, fetchImpl: noBeat, budget: requestBudget(3) }), /REQUEST CEILING/);
    assert.deepEqual(f.writes, []);
  });
  test('creates the ledger once, then EDITS it; never comments on it', async () => {
    const f1 = fake(world());
    const r1 = await pass({ call: f1.call, repo: 'o/r', token: null, now: NOW, fetchImpl: noBeat });
    assert.equal(r1.code, 0, r1.lines.join('\n'));
    assert.deepEqual(f1.writes.map((w) => `${w.method} ${w.path}`), ['POST /issues']);
    assert.equal(f1.writes[0].body.title, 'Autopilot ledger');
    const f2 = fake(world({ '/issues?state=open': [{ number: 12, title: 'Autopilot ledger' }] }));
    await pass({ call: f2.call, repo: 'o/r', token: null, now: NOW, fetchImpl: noBeat });
    assert.deepEqual(f2.writes.map((w) => `${w.method} ${w.path}`), ['PATCH /issues/12']);
    assert.ok(!f2.writes.some((w) => /comments/.test(w.path)));
  });
  test('🔴 a ledger body that is not public is NOT written', async () => {
    const f = fake(world({ '/actions/runs?created': { workflow_runs: [{ id: 1, name: 'CI C:/Users/owner', workflow_id: 1, head_branch: 'main', head_sha: HEAD, status: 'completed', conclusion: 'cancelled', updated_at: iso(1) }] } }));
    const r = await pass({ call: f.call, repo: 'o/r', token: null, now: NOW, fetchImpl: noBeat });
    assert.equal(r.code, 1);
    assert.match(r.lines.at(-1), /ledger NOT written: it carries a C:\/Users path/);
    assert.deepEqual(f.writes, []);
  });
});

describe('.github/workflows/autopilot-watch.yml', () => {
  test('🔴 schedule every 15 min, workflow_run of CI / E2E live on MAIN only (never Land) with the zizmor ignore, dispatch', () => {
    assert.match(WF, /cron: '7,22,37,52 \* \* \* \*'/);
    assert.match(WF, /# zizmor: ignore\[dangerous-triggers\]\n\s+# why:[\s\S]*?workflow_run:\n\s+workflows: \[CI, E2E live\]\n\s+types: \[completed\]\n\s+branches: \[main\]\n/);
    assert.doesNotMatch(WF, /workflows: \[[^\]]*\bLand\b/, 'a Land wake is ~6 an hour more passes against the shared token budget');
    assert.match(WF, /^ {2}workflow_dispatch:$/m);
  });
  test('concurrency autopilot-watch, never cancelled in flight (assert-workflow-hardening); permissions {} at the top', () => {
    assert.match(WF, /group: autopilot-watch\n\s+cancel-in-progress: false/);
    assert.match(WF, /^permissions: \{\}$/m);
  });
  test('🔴 least privilege: actions: write ONLY on the E2E job; every permission has a why; checkouts name main', () => {
    const jobs = WF.split(/\n {2}(?=[a-z0-9-]+:\n)/).slice(1);
    const watch = jobs.find((j) => j.startsWith('watch:'));
    const e2e = jobs.find((j) => j.startsWith('e2e-after-deploy:'));
    assert.match(watch, /actions: read/);
    assert.doesNotMatch(watch, /actions: write/);
    assert.match(e2e, /actions: write/);
    for (const m of WF.matchAll(/\n(\s+)([a-z-]+): (read|write)\n/g)) {
      const before = WF.slice(0, m.index).split('\n').at(-1);
      assert.match(before, /# why:/, `${m[2]}: ${m[3]} has no # why: line above it`);
    }
    assert.equal((WF.match(/ref: main/g) ?? []).length, 2);
    assert.doesNotMatch(WF, /github\.event\./);
  });
});
