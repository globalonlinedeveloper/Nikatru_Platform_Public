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
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
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
  run,
  validateLanes,
  windows,
} from '../../review/self-review.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'tooling', 'review', 'self-review.mjs');
const FIX = join(REPO_ROOT, 'tooling', 'review', 'fixtures', 'reruns-week');
const DOC = join(REPO_ROOT, 'docs', 'ops', 'self-review.md');
const REPO = 'globalonlinedeveloper/Nikatru_Platform_Public';
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

  test('two runs of one workflow on one SHA, red then green, are a flake', () => {
    const run = (id, conclusion, at) => ({ id, name: 'CI', path: '.github/workflows/ci.yml', head_sha: 'a'.repeat(40), head_branch: 'x', status: 'completed', conclusion, created_at: at, run_started_at: at, updated_at: at, run_attempt: 1 });
    const fl = flaky({ runs: [run(1, 'failure', '2026-09-25T01:00:00Z'), run(2, 'success', '2026-09-25T02:00:00Z')], attemptJobs: {} }, WIN.current);
    assert.equal(fl.instances.length, 1);
    assert.equal(fl.instances[0].kind, 'same-sha');
    const fl2 = flaky({ runs: [run(1, 'success', '2026-09-25T01:00:00Z'), run(2, 'failure', '2026-09-25T02:00:00Z')], attemptJobs: {} }, WIN.current);
    assert.equal(fl2.instances.length, 0, 'green then red is a regression, not a flake');
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
    assert.match(r.stdout, /PARTIAL \(budget\)/);
    const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.equal(rep.partial, true);
    assert.equal(rep.stopReason, 'budget');
    assert.equal(rep.requests.sent, 10);
    assert.match(readFileSync(join(out, 'report.md'), 'utf8').split('\n')[0], /PARTIAL — budget/);
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
    const c403 = makeClient(() => ({ status: 403, headers: {}, body: '{}' }), { io: quietIo() });
    await assert.rejects(c403.get('repos/a/b/pulls'), (e) => e.reason === 'rate-limit');
  });

  test('a 304 is served from the ETag cache and still counts against the budget', async () => {
    const dir = tmp();
    const seen = [];
    const tr = (p, etag) => {
      seen.push(etag);
      return etag === 'W/"e1"' ? { status: 304, headers: {}, body: '' } : { status: 200, headers: { etag: 'W/"e1"' }, body: '[{"n":1}]' };
    };
    const io = makeIo([dir]);
    const c1 = makeClient(tr, { cacheDir: dir, io });
    assert.deepEqual((await c1.get('repos/a/b/pulls')).body, [{ n: 1 }]);
    const c2 = makeClient(tr, { cacheDir: dir, io, budget: 1 });
    assert.deepEqual((await c2.get('repos/a/b/pulls')).body, [{ n: 1 }]);
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
