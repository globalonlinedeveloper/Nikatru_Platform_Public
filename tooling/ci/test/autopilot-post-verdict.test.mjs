// autopilot-post-verdict.test.mjs — posting a review verdict pinned to its head
// (tooling/autopilot/post-verdict.mjs). Lane autopilot-reviews,
// row O-REVIEWS-DEPEND-ON-THE-LAPTOP. A fake REST client records every call, so each
// red control proves what was NOT posted.
//
// Run:  node --test "tooling/ci/test/autopilot-post-verdict.test.mjs"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planVerdict, postVerdict, resolveToken, VERDICT_MAX } from '../../autopilot/post-verdict.mjs';
import { restClient } from '../../autopilot/review-paths.mjs';

const SCRIPT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), 'tooling/autopilot/post-verdict.mjs');
const HEAD = 'a'.repeat(40);
const prJson = (labels = [], head = HEAD) => ({ state: 'open', head: { sha: head }, labels: labels.map((name) => ({ name })) });
const fake = (pr) => {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') return { ok: true, status: 200, json: pr, text: '' };
    if (path.endsWith('/reviews')) return { ok: true, status: 200, json: { id: 55 }, text: '' };
    return { ok: true, status: 200, json: {}, text: '' };
  };
  return { call, calls };
};
const APPROVE = 'VERDICT: APPROVE\n- nothing blocking\n';
const CHANGES = 'VERDICT: CHANGES\n- tooling/x.mjs:12 the head is not re-read\n';

describe('post-verdict', () => {
  test('APPROVE: a COMMENT review pinned to the head (never an APPROVE event), then review:approve + land-ok', async () => {
    const { call, calls } = fake(prJson(['needs-review']));
    const r = await postVerdict({ call, n: 9, head: HEAD, text: APPROVE });
    assert.equal(r.code, 0, r.lines.join('\n'));
    const review = calls.find((c) => c.path === '/pulls/9/reviews');
    assert.deepEqual(review.body, { event: 'COMMENT', commit_id: HEAD, body: `VERDICT: APPROVE\nHead: ${HEAD}\n- nothing blocking` });
    assert.ok(!calls.some((c) => c.body?.event === 'APPROVE' || c.body?.event === 'REQUEST_CHANGES'));
    assert.deepEqual(calls.find((c) => c.path === '/issues/9/labels').body, { labels: ['review:approve', 'land-ok'] });
  });
  test('🔴 a MOVED head → refused, NOTHING posted', async () => {
    const { call, calls } = fake(prJson([], 'b'.repeat(40)));
    const r = await postVerdict({ call, n: 9, head: HEAD, text: APPROVE });
    assert.equal(r.code, 1);
    assert.match(r.lines[0], /REFUSED #9: the head moved/);
    assert.deepEqual(calls.map((c) => c.method), ['GET']);
  });
  test('🔴 CHANGES → review:changes, NO land-ok, and a stale review:approve is swapped out', async () => {
    const { call, calls } = fake(prJson(['needs-review', 'review:approve']));
    const r = await postVerdict({ call, n: 9, head: HEAD, text: CHANGES });
    assert.equal(r.code, 0);
    assert.deepEqual(calls.find((c) => c.method === 'POST' && c.path === '/issues/9/labels').body, { labels: ['review:changes'] });
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === '/issues/9/labels/review%3Aapprove'));
    assert.ok(!JSON.stringify(calls).includes('land-ok'));
  });
  test('🔴 land-hold present → APPROVE adds NO land-ok', () => {
    const p = planVerdict({ pr: prJson(['needs-review', 'land-hold']), head: HEAD, text: APPROVE });
    assert.deepEqual(p.add, ['review:approve']);
  });
  test('label swap: APPROVE over an earlier CHANGES removes review:changes', () => {
    const p = planVerdict({ pr: prJson(['review:changes']), head: HEAD, text: APPROVE });
    assert.deepEqual(p.remove, ['review:changes']);
    assert.deepEqual(p.add, ['review:approve', 'land-ok']);
  });
  test('🔴 a verdict file whose first line is not a verdict, or a short sha, is refused', () => {
    assert.match(planVerdict({ pr: prJson(), head: HEAD, text: 'LGTM\nVERDICT: APPROVE' }).refuse, /first line/);
    assert.match(planVerdict({ pr: prJson(), head: 'abc123', text: APPROVE }).refuse, /full commit sha/);
    assert.ok(planVerdict({ pr: prJson(), head: HEAD, text: 'VERDICT: APPROVE\r\n- crlf from Windows\r\n' }).review, 'CRLF verdict files (written on Windows) are read');
  });
  test('the token: environment first, else `gh auth token` spawned shell:false; never printed', () => {
    assert.equal(resolveToken({ env: { GH_TOKEN: 'e' } }), 'e');
    let spec;
    const t = resolveToken({ env: {}, run: (file, args, options) => {
      spec = { file, args, shell: options.shell };
      return 'from-gh\n';
    } });
    assert.equal(t, 'from-gh');
    assert.deepEqual(spec, { file: 'gh', args: ['auth', 'token'], shell: false });
    assert.equal(resolveToken({ env: {}, run: () => { throw new Error('gh not found'); } }), null);
  });
  test('the CLI refuses bad usage (2) and an unreadable verdict file (1)', () => {
    assert.equal(spawnSync(process.execPath, [SCRIPT, '--pr', 'x'], { encoding: 'utf8' }).status, 2);
    const r = spawnSync(process.execPath, [SCRIPT, '--pr', '3', '--head', HEAD, '--verdict-file', '/nonexistent/v.txt'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /REFUSED: the verdict file could not be read/);
  });
  test('🔴 the file\'s text is held to a verdict\'s shape before it is posted (CodeQL 583)', () => {
    assert.match(planVerdict({ pr: prJson(), head: HEAD, text: `VERDICT: APPROVE\nkey ${['ghp', 'R4'.repeat(18)].join('_')}\n` }).refuse, /secret-shaped/);
    assert.match(planVerdict({ pr: prJson(), head: HEAD, text: `VERDICT: CHANGES\n${'x'.repeat(VERDICT_MAX)}` }).refuse, /over/);
  });
  test('🔴 the REST client refuses a repo or a path outside the shapes it builds', async () => {
    assert.throws(() => restClient({ repo: 'evil.example/x/y', token: 't' }), /owner\/name/);
    let called = false;
    const { call } = restClient({ repo: 'o/r', token: 't', fetchImpl: async () => { called = true; return { ok: true, status: 200, text: async () => '' }; } });
    await assert.rejects(call('GET', '@evil.example/x'), /refused request path/);
    await assert.rejects(call('GET', '/a b'), /refused request path/);
    assert.equal(called, false);
    await call('DELETE', `/issues/3/labels/${encodeURIComponent('review:approve')}`);
    assert.equal(called, true);
  });
});
