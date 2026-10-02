// autopilot-issue-queue.test.mjs — tooling/autopilot/issue-queue.mjs, the lane queue as
// Issues in the PRIVATE repo and the race-safe claim (lane autopilot-queue-issues).
//
// One red control per rule; each fails when the rule it names is removed:
//   IQ1  parse/render round trip (every dep kind), and a CRLF body still parses
//   IQ2  the 60,000 split: exactly at the limit is one part, one over is two, every part
//        fits, a surrogate pair is never cut, and a missing part refuses
//   IQ3  a dep on an OPEN issue is unmet (and on one closed not-as-completed)
//   IQ4  a `marker` dep is always unmet in the cloud
//   IQ5  a PR dep is met by a merged head branch; a bad regex is unmet, not met
//   IQ6  the LOWEST comment id wins even when it was posted second in wall time
//   IQ7  a CLAIM by anyone but the repository owner is ignored
//   IQ8  freshness: a PR updated 5 h ago keeps a 10 h claim fresh; 7 h with no PR is stale
//   IQ9  RECLAIM resets the window (and wins it); RELEASE empties it
//   IQ10 nextReady: ready + unclaimed-or-stale + deps met, by priority then number
//   IQ11 housekeepingPlan: merged → done + close; blocked ↔ ready; at most N ops
//   IQ12 claim(): two runners race through a fake API and exactly one wins; the loser
//        YIELDs and drops its label
//   IQ13 the REST layer sends the token only as the Authorization header, and no error
//        message carries it
//
// Every lane name and prompt below is invented. Run:
//   node --test "tooling/ci/test/autopilot-issue-queue.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT, claim, claimFresh, claimWinner, createClient, depsMet, housekeepingPlan, joinPrompt,
  nextReady, parseIssue, renderIssue, splitPrompt,
} from '../../autopilot/issue-queue.mjs';

const OWNER = 'acme-owner';
const LIMIT = CONTRACT.bodyLimit;
const NOW = Date.parse('2026-10-02T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

const lane = (over = {}) => ({
  lane: 'demo-widget',
  priority: '1.5',
  lander: '^autopilot/demo-widget$',
  effort: 'high',
  model: 'model-x',
  ceil: 3,
  acctPref: '3',
  transport: 'cloud',
  deps: [],
  prompt: 'Build the invented widget.\n\nIt has --- in a line\n---\nand a dash line too.',
  ...over,
});

let nextId = 1000;
const c = (body, { id = nextId++, by = OWNER, at = hoursAgo(1) } = {}) => ({ id, body, user: { login: by }, created_at: at });

test('IQ1 parse/render round trip with every dependency kind; CRLF bodies parse', () => {
  const src = lane({
    deps: [
      { kind: 'issue', number: 41 },
      { kind: 'pr', regex: '^autopilot/other-thing(-v2)?$' },
      { kind: 'marker', name: 'lwld-laptop-only' },
    ],
  });
  const { title, body } = renderIssue(src);
  assert.equal(title, 'lane: demo-widget');
  assert.match(body.split('\n')[0], /^<!-- autopilot v1 \{"lane":"demo-widget",/);
  const back = parseIssue({ number: 7, title, body, labels: [{ name: 'cloud-lane' }], state: 'open' });
  for (const k of [...CONTRACT.headerKeys, 'deps', 'prompt']) assert.deepEqual(back[k], src[k], k);
  assert.equal(renderIssue(back).body, body, 'render(parse(x)) === x');
  const crlf = parseIssue({ number: 7, title, body: body.replace(/\n/g, '\r\n') });
  assert.equal(crlf.prompt, src.prompt);
  // red: a title that disagrees with the header is refused, not silently re-laned
  assert.throws(() => parseIssue({ number: 7, title: 'lane: someone-else', body }), /header lane/);
  assert.throws(() => parseIssue({ number: 7, title, body: body.replace('\n---\n', '\nnot a dep\n') }), /neither a dependency line/);
  // a value that would close the HTML comment early is escaped, and reads back unchanged
  for (const lander of ['^a' + '--' + '>b$', '^a' + '--!' + '>b$', '<' + '!-- c']) {
    const r = renderIssue(lane({ lander }));
    const header = r.body.split('\n')[0];
    assert.equal(header.indexOf('>'), header.length - 1, `the header's only '>' is its own closing one (${lander})`);
    assert.equal(parseIssue({ number: 7, ...r }).lander, lander);
  }
});

test('IQ2 split at the 60,000 boundary, and join refuses a missing part', () => {
  const at = 'a'.repeat(LIMIT);
  assert.deepEqual(splitPrompt(at), [at], 'exactly the limit stays one part');
  const over = 'b'.repeat(LIMIT + 1);
  const parts = splitPrompt(over);
  assert.equal(parts.length, 2, 'one character over the limit is two parts');
  assert.equal(parts[0].length, LIMIT);
  assert.match(parts[1], /^<!-- prompt-part 2\/2 -->\n/);
  for (const p of parts) assert.ok(p.length <= LIMIT, `part of ${p.length} fits ${LIMIT}`);
  const comments = parts.slice(1).map((b) => c(b));
  assert.equal(joinPrompt(parts[0], comments, { owner: OWNER }), over);

  const big = 'x'.repeat(LIMIT - 1) + '😀' + 'y'.repeat(10_000);
  const bp = splitPrompt(big);
  assert.ok(!/[\uD800-\uDBFF]$/.test(bp[0]), 'part 1 does not end on half a surrogate pair');
  assert.equal(joinPrompt(bp[0], bp.slice(1).map((b) => c(b))), big);

  const three = splitPrompt('z'.repeat(LIMIT * 2 + 500));
  assert.equal(three.length, 3);
  assert.throws(() => joinPrompt(three[0], [c(three[2])]), /part 2\/3 is missing/);
  // a stranger's "part" is not part of the prompt
  assert.throws(() => joinPrompt(three[0], [c(three[1], { by: 'stranger' }), c(three[2])], { owner: OWNER }), /missing/);
});

test('IQ3 a dep on an open issue is unmet; closed-as-completed is met', () => {
  const dep = [{ kind: 'issue', number: 12 }];
  assert.equal(depsMet(dep, { closedIssues: [], mergedBranches: [] }), false);
  assert.equal(depsMet(dep, { closedIssues: [12], mergedBranches: [] }), true);
  assert.equal(depsMet([], { closedIssues: [] }), true, 'no deps is met');
});

test('IQ4 a marker dep is always unmet in the cloud', () => {
  const dep = [{ kind: 'marker', name: 'lwld-anything' }];
  assert.equal(depsMet(dep, { closedIssues: [1, 2, 3], mergedBranches: ['lwld-anything', 'anything'] }), false);
});

test('IQ5 a PR dep is met by a merged head branch; a bad regex is unmet', () => {
  const dep = [{ kind: 'pr', regex: '^autopilot/demo-(a|b)$' }];
  assert.equal(depsMet(dep, { mergedBranches: ['autopilot/demo-c'] }), false);
  assert.equal(depsMet(dep, { mergedBranches: ['autopilot/demo-b'] }), true);
  assert.equal(depsMet([{ kind: 'pr', regex: '(' }], { mergedBranches: ['('] }), false);
});

test('IQ6 the lowest comment id wins even when posted second in wall time', () => {
  const comments = [
    c('CLAIM runner=cloud-b at=2026-10-02T11:00:05Z nonce=bbbbbbbb', { id: 502, at: '2026-10-02T11:00:05Z' }),
    c('CLAIM runner=cloud-a at=2026-10-02T11:00:09Z nonce=aaaaaaaa', { id: 501, at: '2026-10-02T11:00:09Z' }),
  ];
  assert.equal(claimWinner(comments, { owner: OWNER }).runner, 'cloud-a');
  assert.throws(() => claimWinner(comments), /owner/, 'the owner filter is not optional');
});

test('IQ7 a CLAIM by anyone but the repository owner is ignored', () => {
  const comments = [
    c('CLAIM runner=intruder at=x nonce=00000000', { id: 1, by: 'drive-by-user' }),
    c('CLAIM runner=laptop at=x nonce=11111111', { id: 2 }),
  ];
  assert.equal(claimWinner(comments, { owner: OWNER }).runner, 'laptop');
  assert.equal(claimWinner([comments[0]], { owner: OWNER }), null);
  assert.equal(claimWinner(comments, { owner: OWNER.toUpperCase() }).runner, 'laptop', 'logins compare case-insensitively');
});

test('IQ8 freshness: a PR updated 5 h ago is fresh; 7 h with no PR is stale', () => {
  const old = [c('CLAIM runner=cloud-a at=x nonce=12345678', { at: hoursAgo(10) })];
  assert.equal(claimFresh(old, null, NOW, { owner: OWNER }), false, '10 h, no PR: stale');
  assert.equal(claimFresh(old, hoursAgo(5), NOW, { owner: OWNER }), true, 'PR updated 5 h ago keeps it fresh');
  const seven = [c('CLAIM runner=cloud-a at=x nonce=12345678', { at: hoursAgo(7) })];
  assert.equal(claimFresh(seven, null, NOW, { owner: OWNER }), false, '7 h with no PR: stale');
  const progressed = [...seven, c('PROGRESS routine=trig_123', { at: hoursAgo(2) })];
  assert.equal(claimFresh(progressed, null, NOW, { owner: OWNER }), true, 'a PROGRESS comment refreshes it');
  const strangerProgress = [...seven, c('PROGRESS routine=trig_123', { at: hoursAgo(1), by: 'stranger' })];
  assert.equal(claimFresh(strangerProgress, null, NOW, { owner: OWNER }), false, 'a stranger cannot keep it alive');
  assert.equal(claimFresh([], hoursAgo(0), NOW, { owner: OWNER }), false, 'no claim is not a fresh claim');
});

test('IQ9 RECLAIM resets the window and wins it; RELEASE empties it', () => {
  const comments = [
    c('CLAIM runner=cloud-a at=x nonce=aaaaaaaa', { id: 10, at: hoursAgo(10) }),
    c('PROGRESS routine=trig_a', { id: 11, at: hoursAgo(9) }),
    c('RECLAIM previous=cloud-a runner=laptop at=x', { id: 12, at: hoursAgo(1) }),
    c('CLAIM runner=cloud-b at=x nonce=bbbbbbbb', { id: 13, at: hoursAgo(0.5) }),
  ];
  assert.equal(claimWinner(comments, { owner: OWNER }).runner, 'laptop', 'the RECLAIM holds its window over a later CLAIM');
  assert.equal(claimFresh(comments.slice(0, 3), null, NOW, { owner: OWNER }), true, 'RECLAIM 1 h ago: fresh');
  assert.equal(claimFresh(comments.slice(0, 2), null, NOW, { owner: OWNER }), false, 'control: without the RECLAIM it is stale');
  // a second, newer RECLAIM decides a reclaim race
  const race = [...comments.slice(0, 3), c('RECLAIM previous=cloud-a runner=cloud-c at=x', { id: 14 })];
  assert.equal(claimWinner(race, { owner: OWNER }).runner, 'cloud-c');
  const released = [...comments, c('RELEASE runner=laptop', { id: 20 })];
  assert.equal(claimWinner(released, { owner: OWNER }), null);
  assert.equal(claimFresh(released, null, NOW, { owner: OWNER }), false);
  const reclaimedAfterRelease = [...released, c('CLAIM runner=cloud-d at=x nonce=dddddddd', { id: 22 }), c('CLAIM runner=cloud-e at=x nonce=eeeeeeee', { id: 21 })];
  assert.equal(claimWinner(reclaimedAfterRelease, { owner: OWNER }).runner, 'cloud-e');
});

const parsed = (n, over = {}, labels = ['cloud-lane', 'ready'], comments = []) => ({
  ...parseIssue({ number: n, ...renderIssue(lane({ lane: `lane-${n}`, lander: `^autopilot/lane-${n}$`, ...over })), labels, state: 'open' }),
  comments,
});

test('IQ10 nextReady: ready, unclaimed or stale, deps met; by priority then number', () => {
  const issues = [
    parsed(30, { priority: '2' }),
    parsed(31, { priority: '0.5' }),
    parsed(29, { priority: '2' }),
    parsed(32, { priority: '0.5' }, ['cloud-lane', 'blocked']),
    parsed(33, { priority: '0.5', deps: [{ kind: 'issue', number: 99 }] }),
    parsed(34, { priority: '0.5' }, undefined, [c('CLAIM runner=cloud-a at=x nonce=aaaaaaaa', { at: hoursAgo(1) })]),
    parsed(35, { priority: '1' }, undefined, [c('CLAIM runner=cloud-a at=x nonce=aaaaaaaa', { at: hoursAgo(8) })]),
    parsed(36, { priority: '0.5' }, ['cloud-lane', 'ready', 'done']),
    parsed(37, { priority: '0.5' }, undefined, [c('CLAIM runner=cloud-a at=x nonce=aaaaaaaa', { at: hoursAgo(8) })]),
  ];
  const openPRs = [{ head: { ref: 'autopilot/lane-37' }, updated_at: hoursAgo(1) }];
  const got = nextReady(issues, { owner: OWNER, now: NOW, closedIssues: [], mergedBranches: [], openPRs }).map((i) => i.number);
  assert.deepEqual(got, [31, 35, 29, 30]);
  const met = nextReady(issues, { owner: OWNER, now: NOW, closedIssues: [99], mergedBranches: [], openPRs }).map((i) => i.number);
  assert.deepEqual(met, [31, 33, 35, 29, 30], 'closing #99 makes #33 launchable');
});

test('IQ11 housekeepingPlan: merged → done + close; blocked ↔ ready; at most N ops', () => {
  const issues = [
    parsed(40, {}, ['cloud-lane', 'ready', 'claimed:laptop']),
    parsed(41, { deps: [{ kind: 'issue', number: 40 }] }, ['cloud-lane', 'blocked']),
    parsed(42, { deps: [{ kind: 'pr', regex: '^autopilot/lane-40$' }] }, ['cloud-lane', 'blocked']),
    parsed(43, { deps: [{ kind: 'marker', name: 'lwld-x' }] }, ['cloud-lane', 'ready']),
    parsed(44, {}, ['cloud-lane', 'ready']),
  ];
  const plan = housekeepingPlan(issues, [{ head: { ref: 'autopilot/lane-40' } }], { closedIssues: [], openPRs: [{ head: { ref: 'autopilot/lane-44' } }] });
  assert.deepEqual(plan.slice(0, 2), [
    { op: 'addLabel', number: 40, label: 'done' },
    { op: 'close', number: 40, reason: 'completed' },
  ]);
  assert.ok(plan.some((o) => o.number === 42 && o.op === 'addLabel' && o.label === 'ready'), 'a met PR dep unblocks');
  assert.ok(!plan.some((o) => o.number === 41 && o.label === 'ready'), '#41 waits for #40 to be CLOSED, which this run only plans');
  assert.ok(plan.some((o) => o.number === 43 && o.label === 'blocked'), 'a marker dep can never be ready in the cloud');
  assert.ok(plan.some((o) => o.number === 44 && o.label === 'pr-open'));
  assert.equal(housekeepingPlan(issues, [{ head: { ref: 'autopilot/lane-40' } }], {}, { max: 1 }).length, 1);
});

/** A minimal in-memory issue API: comments get increasing ids in the order they land. */
function fakeIssueApi(owner) {
  let id = 0;
  const comments = [];
  const labels = new Set();
  return {
    owner,
    comments,
    labels,
    addLabels: async (_n, ls) => ls.forEach((l) => labels.add(l)),
    removeLabel: async (_n, l) => labels.delete(l),
    comment: async (_n, body) => { comments.push({ id: ++id, body, user: { login: owner }, created_at: new Date(NOW).toISOString() }); },
    listComments: async () => [...comments],
  };
}

test('IQ12 claim(): a two-runner race has exactly one winner; the loser yields', async () => {
  const api = fakeIssueApi(OWNER);
  // B's claim lands while A is settling — the race the settle exists for.
  let bResult;
  const aSleep = async () => { bResult = await claim(api, 1, 'cloud-b', { sleep: async () => {}, now: () => new Date(NOW) }); };
  const aResult = await claim(api, 1, 'cloud-a', { sleep: aSleep, now: () => new Date(NOW) });
  assert.equal(aResult.won, true, 'A posted first, so A holds the lowest id');
  assert.equal(bResult.won, false);
  assert.equal(bResult.winner.runner, 'cloud-a');
  assert.ok(api.comments.some((x) => x.body === 'YIELD runner=cloud-b'));
  assert.deepEqual([...api.labels], ['claimed:cloud-a']);
  assert.match(api.comments[0].body, /^CLAIM runner=cloud-a at=\S+ nonce=[0-9a-f]{8}$/);
});

test('IQ13 the token goes only in the Authorization header, never into an error', async () => {
  const token = ['tok', Math.random().toString(36).slice(2), 'secret'].join('-');
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: false, status: 403, text: async () => '{"message":"nope"}' }; };
  const client = createClient({ repo: 'acme-owner/queue-private', token, fetchImpl });
  await assert.rejects(client.listIssues(), (e) => {
    assert.ok(!e.message.includes(token), 'the error message does not carry the token');
    assert.match(e.message, /HTTP 403/);
    return true;
  });
  assert.equal(seen[0].init.headers.authorization, `Bearer ${token}`);
  assert.ok(!seen[0].url.includes(token));
  assert.throws(() => createClient({ repo: 'not a repo' }), /owner\/name/);
});
