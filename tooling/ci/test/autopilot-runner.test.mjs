// autopilot-runner.test.mjs — the cloud runner's decisions (tooling/autopilot/runner.mjs)
// and the laptop's hand-back (tooling/autopilot/handback.mjs). Lane autopilot-runners,
// row O-LANES-LAUNCH-ONLY-FROM-THE-LAPTOP. Fixtures are INVENTED lanes and prompts,
// rendered through issue-queue.mjs's own renderIssue (no Private content in Public).
//
// Run:  node --test "tooling/ci/test/autopilot-runner.test.mjs"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIssue, claimLine } from '../../autopilot/issue-queue.mjs';
import { standby, inflight, next, claimVerdict, housekeeping, landOk, run, CLOUD_RUNNERS } from '../../autopilot/runner.mjs';
import { handback, inputPath } from '../../autopilot/handback.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OWNER = 'owner';
const NOW = Date.parse('2026-10-02T12:00:00Z');
const H = 3_600_000;
const iso = (agoH) => new Date(NOW - agoH * H).toISOString();
let cid = 1000;
const comment = (body, agoH = 0, login = OWNER) => ({ id: cid++, body, created_at: iso(agoH), user: { login } });
const claim = (runner, agoH) => comment(claimLine(runner, iso(agoH), 'abcdef01'), agoH);
const lane = (number, name, { labels = ['cloud-lane', 'ready'], comments = [], prio = '1', deps = [], state = 'open' } = {}) => {
  const { title, body } = renderIssue({ lane: name, priority: prio, lander: `^feat/${name}$`, effort: 'high', model: 'opus', ceil: 60, acctPref: '1', transport: 'cloud', deps, prompt: `Invented prompt for ${name}.` });
  return { number, title, body, state, state_reason: state === 'closed' ? 'completed' : null, labels: labels.map((n) => ({ name: n })), comments };
};
const beat = (agoH, mode = 'primary') => ({ v: 1, at: iso(agoH), seq: 2, mode, host: 'laptop' });

describe('standby', () => {
  test('stale/handover → ACT; drill-stale → DRY; fresh/unknown → STANDBY', () => {
    assert.match(standby({ beat: beat(2), now: NOW }), /^ACT/);
    assert.match(standby({ beat: beat(0, 'handover'), now: NOW }), /^ACT/);
    assert.match(standby({ beat: beat(2, 'drill'), now: NOW }), /^DRY/);
    assert.match(standby({ beat: beat(0.1), now: NOW }), /^STANDBY the laptop is primary/);
    assert.match(standby({ beat: '{garbled', now: NOW }), /^STANDBY the laptop state is unknown/);
  });
});

describe('inflight — the cap', () => {
  test('🔴 CAP at RUNNER_INFLIGHT_MAX (3) fresh cloud claims; a RESULT, a stale or a laptop claim does not count', () => {
    const issues = [1, 2, 3].map((n) => lane(n, `l${n}`, { comments: [claim(CLOUD_RUNNERS[n % 2], 1)] }));
    assert.equal(inflight({ issues, owner: OWNER, now: NOW }), 'CAP 3');
    issues[0].comments.push(comment('RESULT pr=#5 head=abc ci-gate=success', 0.5));
    assert.equal(inflight({ issues, owner: OWNER, now: NOW }), 'ROOM 2');
    issues.push(lane(4, 'l4', { comments: [claim('laptop', 1)] }), lane(5, 'l5', { comments: [claim('runner-a', 7)] }));
    assert.equal(inflight({ issues, owner: OWNER, now: NOW }), 'ROOM 2');
  });
});

describe('next — what to claim', () => {
  test('the lowest priority number first; an unclaimed ready lane is picked', () => {
    const issues = [lane(1, 'a', { prio: '2' }), lane(2, 'b', { prio: '0.5' })];
    assert.equal(next({ issues, owner: OWNER, now: NOW }), '2');
  });
  test('🔴 DRY never picks a non-drill issue; ACT never picks a drill issue', () => {
    const issues = [lane(1, 'real'), lane(2, 'drillone', { labels: ['cloud-lane', 'ready', 'drill'] })];
    assert.equal(next({ issues, owner: OWNER, now: NOW, mode: 'DRY' }), '2');
    assert.equal(next({ issues: [issues[0]], owner: OWNER, now: NOW, mode: 'DRY' }), 'NONE');
    assert.equal(next({ issues, owner: OWNER, now: NOW, mode: 'ACT' }), '1');
  });
  test('🔴 a laptop-claimed issue whose PR was updated 5 h ago is never picked', () => {
    const issues = [lane(1, 'busy', { comments: [claim('laptop', 8)] })];
    const openPRs = [{ number: 50, head: { ref: 'feat/busy' }, updated_at: iso(5) }];
    assert.equal(next({ issues, owner: OWNER, now: NOW, openPRs }), 'NONE');
    assert.equal(next({ issues, owner: OWNER, now: NOW, openPRs: [] }), '1', 'with no PR the 8 h claim is stale and reclaimable');
  });
  test('🔴 a claim by a NON-owner is not a claim; a malformed issue is never a candidate', () => {
    const issues = [lane(1, 'x', { comments: [comment(claimLine('runner-b', iso(0.1), 'abcdef02'), 0.1, 'someone')] }), { number: 9, title: 'lane: bad', body: 'nonsense', labels: [{ name: 'cloud-lane' }, { name: 'ready' }], comments: [] }];
    assert.equal(next({ issues, owner: OWNER, now: NOW }), '1');
  });
});

describe('claim-verdict', () => {
  test('🔴 YIELD on a lower id; WIN when mine is the lowest', () => {
    const a = claim('runner-b', 0.05);
    const b = claim('runner-a', 0.04);
    assert.equal(claimVerdict({ comments: [b, a], me: 'runner-a', owner: OWNER }), 'YIELD');
    assert.equal(claimVerdict({ comments: [b, a], me: 'runner-b', owner: OWNER }), 'WIN');
  });
});

describe('housekeeping', () => {
  test('a merged lane PR closes the issue as done; ready↔blocked from deps; stale claims flagged; at most 6 ops', () => {
    const issues = [
      lane(1, 'merged'),
      lane(2, 'waits', { deps: [{ kind: 'issue', number: 1 }] }),
      lane(3, 'stale', { comments: [claim('runner-a', 7)] }),
      ...[4, 5, 6, 7].map((n) => lane(n, `m${n}`)),
    ];
    const mergedPRs = [{ head: { ref: 'feat/merged' } }, ...[4, 5, 6, 7].map((n) => ({ head: { ref: `feat/m${n}` } }))];
    const ops = housekeeping({ issues, mergedPRs, owner: OWNER, now: NOW });
    assert.equal(ops.length, 6, 'capped');
    assert.deepEqual(ops.slice(0, 2), [{ op: 'addLabel', number: 1, label: 'done' }, { op: 'close', number: 1, reason: 'completed' }]);
    const few = housekeeping({ issues: issues.slice(1, 3), mergedPRs: [], owner: OWNER, now: NOW });
    assert.ok(few.some((o) => o.number === 2 && o.label === 'blocked'), JSON.stringify(few));
    assert.ok(few.some((o) => o.op === 'flagStale' && o.number === 3 && o.runner === 'runner-a'));
  });
});

describe('land-ok?', () => {
  const HEAD = 'c'.repeat(40);
  const pr = (over = {}) => ({ draft: false, labels: [], headSha: HEAD, checks: [{ name: 'ci-gate', status: 'completed', conclusion: 'success', details_url: 'https://github.com/o/r/actions/runs/9/job/1' }], runs: [{ id: 9, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', head_sha: HEAD }], ...over });
  test('green, ready, unreviewed-class, pushed by this session → YES', () => assert.equal(landOk({ pr: pr(), pushedHead: HEAD }), 'YES'));
  test('🔴 a needs-review PR NEVER gets YES; nor land-hold, a draft, a red gate, or a head this session did not push', () => {
    assert.match(landOk({ pr: pr({ labels: ['needs-review'] }), pushedHead: HEAD }), /^NO `needs-review`/);
    assert.match(landOk({ pr: pr({ labels: [{ name: 'land-hold' }] }), pushedHead: HEAD }), /^NO `land-hold`/);
    assert.match(landOk({ pr: pr({ draft: true }), pushedHead: HEAD }), /^NO draft/);
    assert.match(landOk({ pr: pr({ checks: [{ name: 'ci-gate', status: 'completed', conclusion: 'failure', details_url: 'https://github.com/o/r/actions/runs/9/job/1' }] }), pushedHead: HEAD }), /^NO ci-gate RED/);
    assert.match(landOk({ pr: pr(), pushedHead: 'd'.repeat(40) }), /not the one this session pushed/);
  });
  test('the CLI: JSON in, the answer out; not JSON → exit 2', () => {
    assert.deepEqual(run('land-ok?', JSON.stringify({ pr: pr(), pushedHead: HEAD })), { code: 0, out: 'YES' });
    assert.equal(run('next', '{oops').code, 2);
    assert.equal(run('nope', '{}').code, 2);
    const r = spawnSync(process.execPath, [join(ROOT, 'tooling/autopilot/runner.mjs'), 'standby'], { input: JSON.stringify({ beat: beat(0.1), now: NOW }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^STANDBY/);
  });
});

describe('handback — the laptop returns', () => {
  const PR = (n, ref, over = {}) => ({ number: n, state: 'open', merged_at: null, head: { ref }, updated_at: iso(1), comments: [], ...over });
  test('🔴 a fresh cloud claim is ADOPT, never FREE', () => {
    const lines = handback({ owner: OWNER, now: NOW, issues: [lane(1, 'cl', { comments: [claim('runner-b', 1)] })], prs: [] });
    assert.deepEqual(lines, ['ADOPT 1 cl place=cloud-runner runner=runner-b']);
  });
  test('🔴 a stale claim becomes FREE only past CLAIM_STALE_H (6 h); with an open PR it is STALE, not FREE', () => {
    assert.match(handback({ owner: OWNER, now: NOW, issues: [lane(1, 's', { comments: [claim('runner-a', 5.9)] })] })[0], /^ADOPT/);
    assert.deepEqual(handback({ owner: OWNER, now: NOW, issues: [lane(1, 's', { comments: [claim('runner-a', 6.1)] })] }), ['FREE 1 s']);
    assert.deepEqual(handback({ owner: OWNER, now: NOW, issues: [lane(1, 's', { comments: [claim('runner-a', 9)] })], prs: [PR(70, 'feat/s', { updated_at: iso(8) })] }), ['STALE 1 s pr=#70 runner=runner-a']);
  });
  test('🔴 a merged PR → DONE even when the issue is still open; failed → FAILED; unclaimed → FREE; laptop → KEEP', () => {
    const lines = handback({
      owner: OWNER,
      now: NOW,
      issues: [lane(1, 'm', { comments: [claim('runner-a', 1)] }), lane(2, 'f', { labels: ['cloud-lane', 'failed'] }), lane(3, 'u'), lane(4, 'k', { comments: [claim('laptop', 1)] })],
      prs: [PR(80, 'feat/m', { state: 'closed', merged_at: iso(0.5) })],
    });
    assert.deepEqual(lines, ['DONE 1 m pr=#80', 'FAILED 2 f', 'FREE 3 u', 'KEEP 4 k place=laptop']);
  });
  test('REVIEWED-BY-CLOUD for a merged PR the cloud reviewer claimed', () => {
    const lines = handback({ owner: OWNER, now: NOW, issues: [], prs: [PR(90, 'feat/z', { merged_at: iso(1), comments: [{ body: `REVIEWING head=${'a'.repeat(40)} by=reviewer at=${iso(2)}` }] }), PR(91, 'feat/y', { merged_at: iso(1) })] });
    assert.deepEqual(lines, ['REVIEWED-BY-CLOUD pr=#90']);
  });
  test('🔴 Windows: `.\\snap.json` and `C:\\…` resolve as the laptop resolves them; a CRLF/BOM file is read', () => {
    assert.equal(inputPath('.\\state\\snap.json', 'C:\\Users\\owner\\Nikatru_Platform_Public', 'win32'), 'C:\\Users\\owner\\Nikatru_Platform_Public\\state\\snap.json');
    assert.equal(inputPath('D:\\x\\s.json', 'C:\\Users\\owner', 'win32'), 'D:\\x\\s.json');
    assert.equal(inputPath('s.json', '/home/u', 'linux'), '/home/u/s.json');
    const tmp = mkdtempSync(join(tmpdir(), 'hb-'));
    try {
      const f = join(tmp, 'in.json');
      writeFileSync(f, `\uFEFF${JSON.stringify({ owner: OWNER, now: NOW, issues: [lane(3, 'u')], prs: [] }, null, 2).replace(/\n/g, '\r\n')}`);
      const r = spawnSync(process.execPath, [join(ROOT, 'tooling/autopilot/handback.mjs'), '--in', f], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.stdout.trim(), 'FREE 3 u');
      assert.equal(spawnSync(process.execPath, [join(ROOT, 'tooling/autopilot/handback.mjs'), '--in', join(tmp, 'missing.json')], { encoding: 'utf8' }).status, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
