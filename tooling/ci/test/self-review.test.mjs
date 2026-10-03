// ─────────────────────────────────────────────────────────────────────────────
// self-review.test.mjs — tooling/review/self-review.mjs must count what
// docs/ops/self-review.md says, stop on its budget, and touch nothing but --out.
//
// Row O-NO-WEEKLY-SELF-REVIEW. The red controls, by Do item of the lane brief:
//   D1  a PR red on its first push then green counts 0 for first-push-green; a
//       re-run passing on the same SHA counts as flaky; a red→green pair on main
//       yields its duration; every METRICS id has a doc section with a
//       Definition, a Source and a How it lies
//   D2  --budget 10 over the fixture that needs 20 requests → exit 2, `budget`,
//       report.json partial, report.md's first line PARTIAL, no proposals; a
//       rate-limit header under the floor stops the next request; a 304 is
//       served from the ETag cache; runs are kept only for the SHA asked; a
//       watched workflow with no run in the window is refused as moved
//   D3  the fixture week where re-runs dominate proposes the flake fix first;
//       the CLI run creates no file outside --out; the write seam refuses one
//       (posix and win32 paths); the CLI recognises itself under a win32
//       drive letter spelled in another case
//
// ⚠️ NOTHING HERE TOUCHES THE NETWORK OR GITHUB. The fixture
// tooling/review/fixtures/reruns-week/responses.json holds GitHub REST
// responses in the shape `gh api -i` returns them, keyed by request path.
//
// Run:  node --test tooling/ci/test/self-review.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_BUDGET,
  MEASURED_WEEK,
  METRICS,
  BudgetStop,
  buildReport,
  classOf,
  collect,
  emptyData,
  firstPushGreen,
  fixtureTransport,
  flaky,
  ghArgs,
  ghTransport,
  incidents,
  isEntry,
  isInside,
  makeClient,
  makeIo,
  parseHttp,
  proposals,
  readRulings,
  renderMarkdown,
  run,
  trimBody,
  validateLanes,
  windows,
} from '../../review/self-review.mjs';
import { RECORDED_ORG } from './fixtures/recorded-org.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'tooling', 'review', 'self-review.mjs');
const FIX = join(REPO_ROOT, 'tooling', 'review', 'fixtures', 'reruns-week');
const DOC = join(REPO_ROOT, 'docs', 'ops', 'self-review.md');
const REPO = `${RECORDED_ORG}/Nikatru_Platform_Public`;
const UNTIL = '2026-10-01T00:00:00Z';
const RESPONSES = JSON.parse(readFileSync(join(FIX, 'responses.json'), 'utf8'));
const WIN = windows(Date.parse(UNTIL) - 7 * 86_400_000, Date.parse(UNTIL));

const tmp = () => mkdtempSync(join(tmpdir(), 'self-review-'));
const quietIo = () => makeIo([tmpdir()]);
async function collected(budget = 600) {
  const client = makeClient(fixtureTransport(RESPONSES), { budget, io: quietIo() });
  const data = emptyData();
  let stop = null;
  try {
    await collect(client, { repo: REPO, win: WIN }, data);
  } catch (e) {
    if (!(e instanceof BudgetStop)) throw e;
    stop = e;
  }
  return { data, stop, client };
}
function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe('D1 — the definitions', () => {
  test('every metric has a doc section with a Definition, a Source and a How it lies', () => {
    const doc = readFileSync(DOC, 'utf8');
    const sections = doc.split(/^## /m).slice(1);
    for (const id of METRICS) {
      const s = sections.find((x) => x.startsWith(`${id}\n`));
      assert.ok(s, `docs/ops/self-review.md has no "## ${id}" section`);
      for (const part of ['**Definition.**', '**Source.**', '**How it lies.**']) assert.ok(s.includes(part), `## ${id} lacks ${part}`);
    }
  });

  test('a PR red on its first push and green later counts 0 for first-push-green', async () => {
    const { data } = await collected();
    const f = firstPushGreen(data, WIN.current);
    assert.ok(f.redPrs.includes(101), 'PR 101 went red on its first head and green on its second');
    assert.equal(f.opened, 9);
    assert.equal(f.green, 4);
    assert.equal(f.red, 5);
    assert.equal(f.rate, 44.4);
    // a re-run green on the same SHA is red here AND named as a flake, so it is priced once
    assert.deepEqual([...f.redThenGreenSameSha].sort(), [103, 104, 105, 106]);
    assert.ok(!f.redThenGreenSameSha.includes(101));
  });

  test('a PR with an empty pull_requests list is matched by its branch and open span', async () => {
    const { data } = await collected();
    const r104 = data.runs.find((r) => r.head_branch === 'lane/p104');
    assert.deepEqual(r104.pull_requests, []);
    assert.equal(r104._pr, 104);
  });

  test('a re-run passing on the same SHA counts as flaky; the ci-gate aggregator never does', async () => {
    const { data } = await collected();
    const fl = flaky(data, WIN.current);
    assert.equal(fl.reruns, 4);
    const names = Object.keys(fl.byName);
    assert.deepEqual(names, ['Guards — the guards can still fail (shard 2)']);
    assert.equal(fl.byName[names[0]].count, 4);
    // red control: the same jobs with no green attempt are not a flake
    const allRed = { ...data, attemptJobs: Object.fromEntries(Object.entries(data.attemptJobs).map(([k, js]) => [k, js.map((j) => ({ ...j, conclusion: 'failure' }))])) };
    assert.equal(flaky(allRed, WIN.current).instances.filter((i) => i.kind === 'rerun').length, 0);
  });

  test('two RUNS on one SHA red then green are never a flake: watcher state changes and re-triggers are not', () => {
    const run = (id, path, event, conclusion, at, branch = 'main') => ({ id, path, event, head_sha: 'a'.repeat(40), head_branch: branch, status: 'completed', conclusion, created_at: at, run_started_at: at, updated_at: at, run_attempt: 1 });
    // ops-watch's cron red, then its next slot green on the same main SHA: the watched state recovered.
    const watcher = [run(1, '.github/workflows/ops-watch.yml', 'schedule', 'failure', '2026-09-25T01:00:00Z'), run(2, '.github/workflows/ops-watch.yml', 'schedule', 'success', '2026-09-25T03:00:00Z')];
    assert.equal(flaky({ runs: watcher, attemptJobs: {} }, WIN.current).instances.length, 0, 'an ops-watch schedule red→green on one main SHA is not a flake');
    // a PR body edit after a red re-triggers ci.yml on the same head (and a newer merge with main): not a flake.
    const retrigger = [run(3, '.github/workflows/ci.yml', 'pull_request', 'failure', '2026-09-25T01:00:00Z', 'lane/x'), run(4, '.github/workflows/ci.yml', 'pull_request', 'success', '2026-09-25T02:00:00Z', 'lane/x')];
    assert.equal(flaky({ runs: retrigger, attemptJobs: {} }, WIN.current).instances.length, 0, 'an `edited` re-trigger is not a flake');
    // a watcher RE-RUN that turns green read the world again: not a flake either.
    const rerun = { ...run(5, '.github/workflows/ops-watch.yml', 'workflow_dispatch', 'success', '2026-09-25T01:00:00Z'), run_attempt: 2 };
    const jobs = [1, 2].map((a) => ({ name: 'probe', head_sha: rerun.head_sha, run_attempt: a, conclusion: a === 1 ? 'failure' : 'success', started_at: '2026-09-25T01:00:00Z', completed_at: '2026-09-25T01:05:00Z' }));
    assert.equal(flaky({ runs: [rerun], attemptJobs: { 5: jobs } }, WIN.current).instances.length, 0, 'a watcher re-run is the state, not a flake');
    // positive control: the SAME job re-run red→green in the SAME pull_request run IS the flake.
    const pr = { ...run(6, '.github/workflows/ci.yml', 'pull_request', 'success', '2026-09-25T01:00:00Z', 'lane/x'), run_attempt: 2 };
    const fl = flaky({ runs: [pr], attemptJobs: { 6: jobs.map((j) => ({ ...j, head_sha: pr.head_sha })) } }, WIN.current);
    assert.equal(fl.instances.length, 1);
    assert.equal(fl.instances[0].kind, 'rerun');
    assert.equal(fl.instances[0].workflow, '.github/workflows/ci.yml', 'a workflow is named by its path, never by a run name');
  });

  test('a red→green pair on main yields its duration, in UTC', async () => {
    const { data } = await collected();
    const inc = incidents(data.runs, '.github/workflows/ci.yml', WIN.current);
    assert.equal(inc.length, 1);
    assert.equal(inc[0].hours, 1);
    assert.equal(inc[0].open, false);
    // a red with no green after it stays open, counted to --until
    const open = incidents(data.runs.filter((r) => r.id !== inc[0].greenRun), '.github/workflows/ci.yml', WIN.current);
    assert.equal(open[0].open, true);
    assert.ok(open[0].hours > 100);
  });

  test('a finding class is read from the tag, the bracket, then the review circle', () => {
    assert.equal(classOf('🔴 class: correctness — x'), 'correctness');
    assert.equal(classOf('- [vacuous] #105 y'), 'vacuous');
    assert.equal(classOf('🟡 rename'), 'nit');
    assert.equal(classOf('🟣 old'), 'pre-existing');
    assert.equal(classOf('plain words'), 'untagged');
  });

  test('each rulings file contributes its own tagged findings; an untagged list item is prose', () => {
    const md = join(FIX, 'reviews', 'rulings.md');
    const json = join(FIX, 'reviews', 'rulings.json');
    const only = (file) => ({ read: (f) => readFileSync(f, 'utf8'), list: () => [path.basename(file)] });
    assert.deepEqual(readRulings(dirname(md), only(md)).map((f) => [f.class, f.pr]), [['correctness', 101], ['vacuous', 105]]);
    assert.deepEqual(readRulings(dirname(json), only(json)).map((f) => [f.class, f.pr]), [['correctness', 107]]);
    assert.equal(readRulings(dirname(md), quietIo()).length, 3);
  });

  test('the lane ledger is held to its schema and never carries an e-mail address', () => {
    assert.equal(validateLanes(JSON.parse(readFileSync(join(FIX, 'lanes.json'), 'utf8'))).length, 2);
    assert.throws(() => validateLanes({ lanes: [{ lane: 'x', branch: 'y', owner: 'someone@example.com' }] }), /e-mail/);
    assert.throws(() => validateLanes({ lanes: [{ branch: 'y' }] }), /lane must be/);
    assert.throws(() => validateLanes({ lanes: [{ lane: 'x', costUsd: -1 }] }), /non-negative/);
    assert.throws(() => validateLanes([]), /expected/);
  });
});

describe('D2 — the budget, the cache, the rate limit, the SHA', () => {
  test('the fixture needs at least 20 requests in full', async () => {
    const { stop, client } = await collected();
    assert.equal(stop, null);
    assert.ok(client.stats().sent >= 20, `sent ${client.stats().sent}`);
  });

  test('--budget 10 on that fixture stops with `budget` and writes a report marked partial', () => {
    const out = join(tmp(), 'out');
    const r = spawnSync(process.execPath, [SCRIPT, '--out', out, '--until', UNTIL, '--fixture', join(FIX, 'responses.json'), '--budget', '10'], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /INCOMPLETE \(budget\)/);
    const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.equal(rep.partial, true);
    assert.equal(rep.status, 'INCOMPLETE');
    // what WAS measured is still written: the PR list and the runs were read before the stop
    assert.ok(rep.metrics['first-push-green'].opened > 0, 'an incomplete week still writes what it measured');
    assert.equal(rep.stopReason, 'budget');
    assert.equal(rep.requests.sent, 10);
    assert.match(readFileSync(join(out, 'report.md'), 'utf8').split('\n')[0], /INCOMPLETE — budget/);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'proposals.json'), 'utf8')), []);
  });

  test('the full budget on the same fixture is complete and exits 0', () => {
    const out = join(tmp(), 'out');
    const r = spawnSync(process.execPath, [SCRIPT, '--out', out, '--until', UNTIL, '--fixture', join(FIX, 'responses.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).partial, false);
    assert.ok(r.stdout.trim().split('\n').length <= 4, 'the summary is short');
  });

  test('x-ratelimit-remaining under the floor stops the NEXT request with rate-limit', async () => {
    const tr = () => ({ status: 200, headers: { 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': '1790000000' }, body: '[]' });
    const c = makeClient(tr, { rateFloor: 100, io: quietIo() });
    await c.get('repos/a/b/pulls');
    await assert.rejects(c.get('repos/a/b/pulls?page=2'), (e) => e instanceof BudgetStop && e.reason === 'rate-limit');
    assert.equal(c.stats().sent, 1);
    const c403 = makeClient(() => ({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' } , body: '{}' }), { io: quietIo() });
    await assert.rejects(c403.get('repos/a/b/pulls'), (e) => e.reason === 'rate-limit' && /resets at/.test(e.message));
    const c403s = makeClient(() => ({ status: 403, headers: { 'retry-after': '60' }, body: '{}' }), { io: quietIo() });
    await assert.rejects(c403s.get('repos/a/b/pulls'), (e) => e.reason === 'rate-limit');
    const c429 = makeClient(() => ({ status: 429, headers: {}, body: '{}' }), { io: quietIo() });
    await assert.rejects(c429.get('repos/a/b/pulls'), (e) => e.reason === 'rate-limit');
  });

  test('a 403 with no spent quota and no retry-after is a permission refusal (http), never `rate-limit`', async () => {
    const tr = () => ({ status: 403, headers: { 'x-ratelimit-remaining': '4990' }, body: '{"message":"Resource not accessible by integration"}' });
    const c = makeClient(tr, { io: quietIo() });
    await assert.rejects(c.get('repos/a/b/pulls'), (e) => e instanceof BudgetStop && e.reason === 'http' && !/resets at/.test(e.message));
  });

  test('a 5xx is retried twice, each retry counted against the budget, then stops with `http`', async () => {
    let n = 0;
    const flaky502 = () => (++n === 1 ? { status: 502, headers: {}, body: '' } : { status: 200, headers: {}, body: '[]' });
    const c = makeClient(flaky502, { io: quietIo() });
    assert.deepEqual((await c.get('repos/a/b/pulls')).body, []);
    assert.equal(c.stats().sent, 2);
    assert.equal(c.stats().retried, 1);
    const always = makeClient(() => ({ status: 502, headers: {}, body: '' }), { io: quietIo() });
    await assert.rejects(always.get('repos/a/b/pulls'), (e) => e.reason === 'http' && /502 after 2 retries/.test(e.message));
    assert.equal(always.stats().sent, 3);
    // the retries are requests: a budget of 2 stops the second retry before it is sent
    const tight = makeClient(() => ({ status: 502, headers: {}, body: '' }), { io: quietIo(), budget: 2 });
    await assert.rejects(tight.get('repos/a/b/pulls'), (e) => e.reason === 'budget');
    assert.equal(tight.stats().sent, 2);
  });

  test('a 304 is served from the ETag cache and still counts against the budget', async () => {
    const dir = tmp();
    const seen = [];
    const tr = (p, etag) => {
      seen.push(etag);
      return etag === 'W/"e1"' ? { status: 304, headers: {}, body: '' } : { status: 200, headers: { etag: 'W/"e1"' }, body: '[{"number":1,"head":{"ref":"x"}}]' };
    };
    const io = makeIo([dir]);
    const c1 = makeClient(tr, { cacheDir: dir, io });
    assert.deepEqual((await c1.get('repos/a/b/pulls')).body, [{ number: 1, head: { ref: 'x' } }]);
    const c2 = makeClient(tr, { cacheDir: dir, io, budget: 1 });
    assert.deepEqual((await c2.get('repos/a/b/pulls')).body, [{ number: 1, head: { ref: 'x' } }]);
    assert.deepEqual(seen, [null, 'W/"e1"']);
    assert.equal(c2.stats().notModified, 1);
    await assert.rejects(c2.get('repos/a/b/pulls'), (e) => e.reason === 'budget');
  });

  test('a check run for another SHA is dropped, never read as this SHA\'s verdict', async () => {
    const sha = Object.keys(RESPONSES).find((k) => k.includes('/check-runs?')).split('/commits/')[1].split('/')[0];
    const key = Object.keys(RESPONSES).find((k) => k.includes(`/commits/${sha}/`));
    const poisoned = { ...RESPONSES, [key]: { ...RESPONSES[key], body: { check_runs: RESPONSES[key].body.check_runs.map((c) => ({ ...c, head_sha: 'f'.repeat(40) })) } } };
    const client = makeClient(fixtureTransport(poisoned), { io: quietIo() });
    const data = await collect(client, { repo: REPO, win: WIN });
    assert.deepEqual(data.gateBySha[sha], []);
  });

  test('a watched workflow with no run in the window is refused as moved, never computed on nothing', async () => {
    const { data } = await collected();
    assert.equal(buildReport(structuredClone(data), WIN, { repo: REPO, stats: {} }).partial, false);
    const renamed = { ...structuredClone(data), runs: data.runs.map((r) => (r.path === '.github/workflows/ops-watch.yml' ? { ...r, path: '.github/workflows/ops-watch-v2.yml' } : r)) };
    const rep = buildReport(renamed, WIN, { repo: REPO, stats: {} });
    assert.equal(rep.partial, true);
    assert.equal(rep.stopReason, 'workflow-moved');
    assert.match(rep.stopDetail, /ops-watch\.yml/);
    assert.deepEqual(rep.proposals, []);
  });

  test('gh is spawned with an argv and no shell, and a path never carries a leading slash', () => {
    assert.deepEqual(ghArgs('repos/a/b/pulls?x=1', 'W/"e"').slice(0, 5), ['api', '-i', '--method', 'GET', 'repos/a/b/pulls?x=1']);
    assert.ok(ghArgs('repos/a/b', 'W/"e"').includes('If-None-Match: W/"e"'));
    assert.throws(() => ghArgs('/repos/a/b'), /refusing/);
    assert.throws(() => ghArgs('repos/a b'), /refusing/);
    const calls = [];
    const tr = ghTransport({ spawn: (cmd, argv, opts) => (calls.push({ cmd, argv, opts }), { status: 0, stdout: 'HTTP/2.0 200 OK\r\nEtag: W/"z"\r\nX-Ratelimit-Remaining: 4999\r\n\r\n{"ok":true}' }) });
    const r = tr('repos/a/b/pulls', null);
    assert.equal(calls[0].cmd, 'gh');
    assert.equal(calls[0].opts.shell, false);
    assert.equal(r.status, 200);
    assert.equal(r.headers.etag, 'W/"z"');
    assert.equal(r.headers['x-ratelimit-remaining'], '4999');
    assert.equal(r.body, '{"ok":true}');
    assert.equal(parseHttp('HTTP/2.0 304 Not Modified\nEtag: W/"z"\n\n').status, 304);
    assert.equal(parseHttp('gh: not found'), null);
  });
});

describe('D3 — three proposals, never applied', () => {
  test('a week where re-runs dominate proposes the flake fix first', async () => {
    const { data } = await collected();
    const rep = buildReport(data, WIN, { repo: REPO, stats: {} });
    assert.equal(rep.proposals.length, 3);
    assert.equal(rep.proposals[0].kind, 'flake');
    assert.match(rep.proposals[0].lane, /^fix-flake-/);
    for (const [i, p] of rep.proposals.entries()) {
      assert.deepEqual(Object.keys(p).slice(0, 5), ['lane', 'brief', 'priority', 'deps', 'note']);
      assert.equal(p.priority, i + 1);
      assert.deepEqual(p.deps, []);
      assert.equal(p.note, 'self-review 2026-10-01');
      assert.match(p.brief, /Measured cost: [\d.]+ min\./);
    }
    // red control: without the re-runs, the flake is not first
    const calm = { ...data, attemptJobs: {}, runs: data.runs.map((r) => ({ ...r, run_attempt: 1 })) };
    const rep2 = buildReport(calm, WIN, { repo: REPO, stats: {} });
    assert.notEqual(rep2.proposals[0]?.kind, 'flake');
  });

  test('a partial report proposes nothing', async () => {
    const { data, stop } = await collected(10);
    assert.equal(stop.reason, 'budget');
    assert.deepEqual(buildReport(data, WIN, { repo: REPO, stop, stats: {} }).proposals, []);
    assert.deepEqual(proposals({ ciCycleMinutes: 0, metrics: { flaky: { reruns: 0, byName: {}, instances: [] }, 'first-push-green': { redPrs: [], redThenGreenSameSha: [] }, mttr: { main: { redHours: 0 }, opsWatch: { redHours: 0 } }, 'cost-per-lane': [], 'review-findings': { byClass: {} } } }, 'd'), []);
  });

  test('the CLI run creates no file outside --out', () => {
    const root = tmp();
    cpSync(FIX, join(root, 'in'), { recursive: true });
    const before = walk(root);
    const out = join(root, 'out');
    const r = spawnSync(
      process.execPath,
      [SCRIPT, '--out', out, '--until', UNTIL, '--fixture', join(root, 'in', 'responses.json'), '--lanes', join(root, 'in', 'lanes.json'), '--reviews', join(root, 'in', 'reviews')],
      { encoding: 'utf8', cwd: root },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const added = walk(root).filter((f) => !before.includes(f));
    assert.ok(added.length >= 3);
    for (const f of added) assert.ok(isInside(out, f), `${f} was written outside --out`);
    rmSync(root, { recursive: true, force: true });
  });

  test('the in-process run writes only through the seam, only under --out', async () => {
    const root = tmp();
    const writes = [];
    const fs = {
      readFileSync,
      readdirSync,
      statSync,
      mkdirSync: (p, o) => mkdirSync(p, o),
      writeFileSync: (p) => writes.push(p),
    };
    const code = await run(['--out', join(root, 'out'), '--until', UNTIL, '--fixture', join(FIX, 'responses.json')], { fs, log: () => {} });
    assert.equal(code, 0);
    assert.ok(writes.length >= 3);
    for (const w of writes) assert.ok(isInside(join(root, 'out'), w), w);
  });

  test('the write seam refuses a path outside its roots — posix and win32', () => {
    const io = makeIo(['/tmp/out'], { mkdirSync() {}, writeFileSync() {} }, path.posix);
    assert.throws(() => io.write('/tmp/elsewhere/queue.json', 'x'), /outside/);
    assert.throws(() => io.write('/tmp/out/../queue.json', 'x'), /outside/);
    const w = path.win32;
    assert.ok(isInside('C:\\Users\\lead\\out', 'c:\\users\\LEAD\\out\\report.md', w), 'a drive letter and case differ only in spelling on win32');
    assert.ok(!isInside('C:\\Users\\lead\\out', 'C:\\Users\\lead\\outside\\x.md', w));
    assert.ok(!isInside('C:\\Users\\lead\\out', 'D:\\Users\\lead\\out\\x.md', w));
    const wio = makeIo(['C:\\Users\\lead\\out'], { mkdirSync() {}, writeFileSync() {} }, w);
    assert.doesNotThrow(() => wio.write('C:/Users/lead/out/report.md', 'x'));
    assert.throws(() => wio.write('C:\\Users\\lead\\briefs\\q.json', 'x'), /outside/);
  });

  test('the CLI recognises itself when the drive letter is spelled in another case on win32', () => {
    const w = path.win32;
    assert.ok(isEntry('c:\\repo\\tooling\\review\\self-review.mjs', 'C:\\repo\\tooling\\review\\self-review.mjs', w));
    assert.ok(isEntry('C:/repo/tooling/review/self-review.mjs', 'C:\\repo\\tooling\\review\\self-review.mjs', w));
    assert.ok(!isEntry('C:\\repo\\tooling\\review\\other.mjs', 'C:\\repo\\tooling\\review\\self-review.mjs', w));
    assert.ok(!isEntry(undefined, 'C:\\repo\\x.mjs', w));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Review 2026-10-02 of PR #1159 (lead ruling, items 1-6). Each block below is a
// red control: it fails on the code the review read.
// ─────────────────────────────────────────────────────────────────────────────
describe('R1 — the documented defaults complete a real week', () => {
  test('the default budget is sized from the measured real week, with headroom', () => {
    assert.ok(Number.isInteger(MEASURED_WEEK.requests) && MEASURED_WEEK.requests > 0);
    assert.match(MEASURED_WEEK.asOf, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(DEFAULT_BUDGET >= Math.ceil(MEASURED_WEEK.requests * 1.5), `DEFAULT_BUDGET ${DEFAULT_BUDGET} < 1.5 × the measured ${MEASURED_WEEK.requests}`);
    const doc = readFileSync(DOC, 'utf8');
    assert.ok(doc.includes(`(default ${DEFAULT_BUDGET})`), 'docs/ops/self-review.md states the default budget the script uses');
  });

  test('a budget that runs out in the TREND\'s gate reads still leaves the week complete, and it proposes', async () => {
    const full = (await collected()).client.stats().sent;
    const { data, stop } = await collected(full - 1);
    assert.equal(stop, null, 'a stop in the trend is not a stop of the week');
    assert.equal(data.trendStop?.reason, 'budget');
    assert.ok(data.phases.includes('gate:current'));
    const rep = buildReport(data, WIN, { repo: REPO, stats: {} });
    assert.equal(rep.partial, false);
    assert.equal(rep.status, 'complete');
    assert.equal(rep.proposals.length, 3, 'the current window still proposes');
    assert.equal(rep.trendStop.reason, 'budget');
    assert.ok(rep.trend.some((t) => t.firstPushGreen === null), 'the trend week it did not reach reads n/a');
    assert.match(renderMarkdown(rep), /trend's ci-gate reads stopped \(budget\)/);
  });

  test('an error that is not a stop still writes what was measured, marked INCOMPLETE', async () => {
    const root = tmp();
    let n = 0;
    const tr = (p) => {
      if (++n > 3) throw new TypeError('boom "with a quoted body someone@example.com"');
      return fixtureTransport(RESPONSES)(p);
    };
    const out = join(root, 'out');
    const code = await run(['--out', out, '--until', UNTIL], { transport: tr, log: () => {} });
    assert.equal(code, 2);
    const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.equal(rep.status, 'INCOMPLETE');
    assert.equal(rep.stopReason, 'error');
    assert.ok(!/@/.test(rep.stopDetail), 'the error text is quoted out, never copied in');
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'proposals.json'), 'utf8')), []);
    assert.match(readFileSync(join(out, 'report.md'), 'utf8').split('\n')[0], /INCOMPLETE — error/);
    rmSync(root, { recursive: true, force: true });
  });

  test('a week past the list ceiling is read one page, then by day — never paged in full first', async () => {
    const seen = [];
    const tr = (p) => {
      seen.push(p);
      if (/\/pulls\?/.test(p) || /\/pulls\/comments/.test(p)) return { status: 200, headers: {}, body: '[]' };
      const m = /created=([^&]+)/.exec(p);
      const [a, b] = decodeURIComponent(m[1]).split('..').map(Date.parse);
      const week = b - a > 86_400_000;
      const next = week ? `<https://api.github.com/${p}&page=2>; rel="next"` : '';
      return { status: 200, headers: { link: next }, body: JSON.stringify({ total_count: week ? 1500 : 200, workflow_runs: [] }) };
    };
    const c = makeClient(tr, { io: quietIo() });
    await collect(c, { repo: REPO, win: WIN });
    const weekReads = seen.filter((p) => /actions\/runs\?/.test(p) && !/page=2/.test(p)).length;
    assert.equal(seen.filter((p) => /page=2/.test(p)).length, 0, 'the over-ceiling week was paged before the day split');
    assert.equal(weekReads, 4 + 4 * 7, 'one first page per week, then each of its seven days');
  });
});

describe('R2 — the review\'s real week drops to the true flake count', () => {
  const REAL = JSON.parse(readFileSync(join(REPO_ROOT, 'tooling', 'review', 'fixtures', 'real-week-2026-10-02', 'runs-and-jobs.json'), 'utf8'));
  const RW = { since: Date.parse(REAL.window.since), until: Date.parse(REAL.window.until) };
  /** The rule the review read: two runs of one workflow on one head SHA, red then green. */
  function sameShaPairs(runs) {
    const g = new Map();
    for (const r of runs.filter((x) => x.status === 'completed' && Date.parse(x.created_at) >= RW.since && Date.parse(x.created_at) < RW.until)) {
      const k = `${r.path}|${r.head_sha}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    }
    return [...g.values()].filter((rs) => {
      rs.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      const i = rs.findIndex((r) => ['failure', 'timed_out'].includes(r.conclusion));
      return i !== -1 && rs.slice(i + 1).some((r) => r.conclusion === 'success');
    });
  }
  test('the 14 same-SHA pairs the review counted are here, 13 of them watcher runs', () => {
    const pairs = sameShaPairs(REAL.runs);
    assert.equal(pairs.length, 14);
    assert.equal(pairs.filter((rs) => rs.every((r) => ['schedule', 'workflow_dispatch'].includes(r.event))).length, 13);
  });
  test('flaky() counts only same-run re-runs of real jobs: 26, no watcher, no aggregator', () => {
    const fl = flaky({ runs: REAL.runs, attemptJobs: REAL.attemptJobs }, RW);
    assert.equal(fl.instances.length, 26);
    assert.ok(fl.instances.every((i) => i.kind === 'rerun'));
    const events = new Set(fl.instances.map((i) => REAL.runs.find((r) => r.id === i.runId).event));
    assert.ok(!events.has('schedule') && !events.has('workflow_dispatch'), 'a watcher run is never a flake');
    for (const agg of ['extensions / ci-required', 'lane-workers / lane-verdict', 'ci-gate']) assert.ok(!fl.byName[agg], `${agg} is red because a job it waited on was`);
    assert.equal(fl.byName['Guards — platform, data and ops'].count, 15);
    // the instances name workflows by path, never by a run name
    assert.ok(fl.instances.every((i) => /^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(i.workflow)));
  });
});

describe('R4 — a cancelled or skipped first gate gave no verdict', () => {
  const sha = 'd'.repeat(40);
  const data = (checks) => ({
    prs: [{ number: 900, created_at: '2026-09-25T00:00:00Z', head: { ref: 'lane/z' } }],
    runs: [{ id: 1, path: '.github/workflows/ci.yml', event: 'pull_request', head_sha: sha, head_branch: 'lane/z', created_at: '2026-09-25T00:01:00Z', pull_requests: [{ number: 900 }], _pr: 900 }],
    gateBySha: { [sha]: checks },
  });
  const gate = (conclusion, at, run = 1) => ({ head_sha: sha, status: 'completed', conclusion, started_at: at, runId: run });
  test('cancelled then green on the same SHA is green; cancelled alone is superseded, in neither count', () => {
    const g = firstPushGreen(data([gate('cancelled', '2026-09-25T00:02:00Z'), gate('success', '2026-09-25T00:10:00Z', 2)]), WIN.current);
    assert.equal(g.green, 1);
    assert.equal(g.red, 0);
    assert.deepEqual(g.redThenGreenSameSha, []);
    const s = firstPushGreen(data([gate('cancelled', '2026-09-25T00:02:00Z'), gate('skipped', '2026-09-25T00:03:00Z', 2)]), WIN.current);
    assert.deepEqual([s.green, s.red], [0, 0]);
    assert.deepEqual(s.excluded, [{ pr: 900, verdict: 'superseded' }]);
  });
  test('red then green in ANOTHER run on that SHA (an `edited` re-trigger) stays red on the change; in the same run it is a re-run', () => {
    const other = firstPushGreen(data([gate('failure', '2026-09-25T00:02:00Z', 1), gate('success', '2026-09-25T00:10:00Z', 2)]), WIN.current);
    assert.deepEqual(other.redPrs, [900]);
    assert.deepEqual(other.redThenGreenSameSha, []);
    const same = firstPushGreen(data([gate('failure', '2026-09-25T00:02:00Z', 1), gate('success', '2026-09-25T00:10:00Z', 1)]), WIN.current);
    assert.deepEqual(same.redThenGreenSameSha, [900]);
  });
});

describe('R3 — no e-mail address, login or name under --out', () => {
  test('a run over responses carrying e-mails, logins and a run name with a login writes none of them', () => {
    const root = tmp();
    const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    const LOGIN = 'planted-login-x7';
    const NAME = 'Planted Person';
    const mail = 'planted.person@example.org';
    const actor = { login: LOGIN, id: 1, html_url: `https://github.com/${LOGIN}` };
    const planted = {};
    for (const [k, v] of Object.entries(RESPONSES)) {
      if (k === '_readme') continue;
      let body = structuredClone(v.body);
      if (body?.workflow_runs) {
        body.workflow_runs = body.workflow_runs.map((r) => ({
          ...r,
          name: `CI on PR by @${LOGIN}`,
          display_title: `fix by @${LOGIN}`,
          actor,
          triggering_actor: actor,
          head_commit: { id: r.head_sha, message: `by ${NAME}`, author: { name: NAME, email: mail }, committer: { name: NAME, email: mail } },
        }));
      }
      if (Array.isArray(body)) body = body.map((x) => ({ ...x, user: actor, ...(x.body !== undefined ? { body: `${x.body} cc @${LOGIN} <${mail}>` } : {}) }));
      if (body?.jobs) body.jobs = body.jobs.map((j) => ({ ...j, runner_name: `${LOGIN}-runner`, workflow_name: `CI on PR by @${LOGIN}` }));
      // every response carries an ETag, so every body is cached
      planted[k] = { ...v, headers: { ...(v.headers ?? {}), etag: `W/"${k.length}"` }, body };
    }
    const fx = join(root, 'planted.json');
    writeFileSync(fx, JSON.stringify(planted));
    const out = join(root, 'out');
    const r = spawnSync(process.execPath, [SCRIPT, '--out', out, '--until', UNTIL, '--fixture', fx], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const files = walk(out);
    assert.ok(files.some((f) => f.includes(`${path.sep}.cache${path.sep}`)), 'the cache was written, so it was scanned');
    assert.ok(files.length > 10);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      assert.ok(!EMAIL_RE.test(text), `${path.relative(out, f)} carries an e-mail address`);
      assert.ok(!text.includes(LOGIN), `${path.relative(out, f)} carries a login`);
      assert.ok(!text.includes(NAME), `${path.relative(out, f)} carries a name`);
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('trimBody keeps only the fields the report reads, and an unknown endpoint keeps nothing', () => {
    const run = trimBody('repos/a/b/actions/runs?created=x', { total_count: 1, workflow_runs: [{ id: 1, path: 'p', name: 'n @x', head_commit: { author: { email: 'a@b.co' } }, actor: {}, pull_requests: [{ number: 3, url: 'u' }] }] });
    assert.deepEqual(run, { total_count: 1, workflow_runs: [{ id: 1, path: 'p', pull_requests: [{ number: 3 }] }] });
    assert.deepEqual(trimBody('repos/a/b/pulls/comments?x', [{ id: 1, body: '🔴 class: correctness by @x', user: { login: 'x' }, created_at: 't' }]), [{ id: 1, in_reply_to_id: null, created_at: 't', pull_request_url: undefined, class: 'correctness' }]);
    assert.equal(trimBody('repos/a/b/issues', [{ user: { login: 'x' } }]), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fixtures are public-repo content, so the secret scan reads them. Their
// synthetic job IDs were once 12-digit numbers starting 3, which IS the
// nikatru-india-aadhaar shape: CI's gitleaks fired 16 times on responses.json.
// The fix is the fixture, never an allowlist entry. This reads the rule from
// the REAL .gitleaks.toml (not a copy, so a rule change is followed) and runs
// it over every fixture file, line by line.
// ─────────────────────────────────────────────────────────────────────────────
describe('the fixtures stay outside the secret scan', () => {
  const FIXTURES = join(REPO_ROOT, 'tooling', 'review', 'fixtures');
  const GITLEAKS = join(REPO_ROOT, '.gitleaks.toml');

  function aadhaarRule() {
    const toml = readFileSync(GITLEAKS, 'utf8');
    const at = toml.indexOf('id = "nikatru-india-aadhaar"');
    assert.ok(at >= 0, '.gitleaks.toml no longer has the nikatru-india-aadhaar rule');
    const m = /^regex = '''(.*)'''$/m.exec(toml.slice(at));
    assert.ok(m, 'the nikatru-india-aadhaar rule has no regex line');
    return new RegExp(m[1]);
  }

  function filesUnder(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]);
  }

  test('the rule read from .gitleaks.toml still fires on the old job-ID shape (liveness)', () => {
    const re = aadhaarRule();
    // Built from 4-digit pieces so this file is not itself a finding.
    const old = ['3650', '0000', '0031'].join('');
    assert.ok(re.test(`     "id": ${old},`), 'the rule must match the old fixture line, or the next test proves nothing');
    assert.ok(!re.test(`     "id": 1${old.slice(1)},`), 'an ID starting 1 is outside the rule');
  });

  test('no line of any fixture under tooling/review/fixtures matches nikatru-india-aadhaar', () => {
    const re = aadhaarRule();
    const files = filesUnder(FIXTURES);
    assert.ok(files.length >= 4, `expected the fixture files, found ${files.length}`);
    const hits = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (re.test(line)) hits.push(`${path.relative(REPO_ROOT, f)}:${i + 1}`);
      });
    }
    assert.deepEqual(hits, [], `gitleaks nikatru-india-aadhaar would fire on:\n  ${hits.join('\n  ')}`);
  });
});
