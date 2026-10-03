// autopilot-issue-queue.test.mjs — tooling/autopilot/issue-queue.mjs, the lane queue as
// Issues in the PRIVATE repo and the race-safe claim (lane autopilot-queue-issues).
//
// One red control per rule; each fails when the rule it names is removed:
//   IQ1  parse/render round trip (every dep kind), and a CRLF body still parses
//   IQ2  the 60,000 split: exactly at the limit is one part, one over is two, every part
//        fits, a surrogate pair is never cut, and a missing part refuses
//   IQ3  a dep on an OPEN issue is unmet (and on one closed not-as-completed)
//   IQ4  a `marker` dep is unknown (so unmet for launching) in the cloud, and met only
//        through the laptop's `markersMet`
//   IQ5  a PR dep is met by a merged head branch; a bad regex is unmet, not met
//   IQ6  the LOWEST comment id wins even when it was posted second in wall time
//   IQ7  a CLAIM by anyone but the repository owner is ignored
//   IQ8  freshness: a PR updated 5 h ago keeps a 10 h claim fresh; 7 h with no PR is stale
//   IQ9  a valid RECLAIM (stale holder by the comments' clock, `previous=` names it, no
//        launch record) resets the window and wins it; a holder's RELEASE empties it
//   IQ10 nextReady: ready + unclaimed-or-stale + deps met, by priority then number
//   IQ11 housekeepingPlan: merged → done + close; blocked ↔ ready; an unknown marker
//        flips nothing (never undoes the laptop); at most N ops
//   IQ12 claim(): two runners race through a fake API and exactly one wins; the loser
//        YIELDs and drops its label
//   IQ13 the REST layer sends the token only as the Authorization header, and no error
//        message carries it
//   IQ14 two claimants with the SAME runner id race: exactly one wins (by comment id)
//   IQ15 an invalid RECLAIM — late (over a fresh reclaim), over a fresh claim, naming the
//        wrong holder, or over a launched holder — is a plain claim and loses
//   IQ16 nextReady and claim() agree on a stale lane: claim() RECLAIMs it and wins, once;
//        a launched-stale lane is neither offered nor taken; a fresh one is refused unwritten
//   IQ17 a migration stub is never flipped to `ready`, never offered, never launchable
//   IQ19 an invalid RECLAIM 10 s short of stale (a claimant's clock ahead) and a losing
//        CLAIM do not refresh the holder's window: it goes stale on the holder's own clock
//   IQ20 claim() on a migration stub, or on an empty prompt, throws and writes nothing
//   IQ18 fail closed: an issue without a comments array throws; free-text owner comments
//        that start with a verb are not protocol lines
//
// Every lane name and prompt below is invented. Run:
//   node --test "tooling/ci/test/autopilot-issue-queue.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT, MIGRATION_STUB_MARKER, MIGRATION_STUB_PROMPT, assertLaunchable, claim, claimFresh, claimState,
  claimWinner, createClient, depsMet, housekeepingPlan, joinPrompt, nextReady, parseEvent, parseIssue,
  renderIssue, splitPrompt,
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

test('IQ4 a marker dep is unmet in the cloud, and met only through the laptop\'s markersMet', () => {
  const dep = [{ kind: 'marker', name: 'lwld-anything' }];
  assert.equal(depsMet(dep, { closedIssues: [1, 2, 3], mergedBranches: ['lwld-anything', 'anything'] }), false);
  assert.equal(depsMet(dep, { markersMet: ['lwld-other'] }), false);
  assert.equal(depsMet(dep, { markersMet: ['lwld-anything'] }), true, 'the laptop says the marker reads land exit=0');
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

test('IQ9 a valid RECLAIM resets the window and wins it; the holder\'s RELEASE empties it', () => {
  const comments = [
    c('CLAIM runner=cloud-a at=x nonce=aaaaaaaa', { id: 10, at: hoursAgo(10) }),
    c('RECLAIM previous=cloud-a runner=laptop at=x', { id: 12, at: hoursAgo(1) }),
    c('CLAIM runner=cloud-b at=x nonce=bbbbbbbb', { id: 13, at: hoursAgo(0.5) }),
  ];
  assert.equal(claimWinner(comments, { owner: OWNER }).runner, 'laptop', 'the RECLAIM holds its window over a later CLAIM');
  assert.equal(claimWinner(comments, { owner: OWNER }).verb, 'RECLAIM');
  assert.equal(claimFresh(comments.slice(0, 2), null, NOW, { owner: OWNER }), true, 'RECLAIM 1 h ago: fresh');
  assert.equal(claimFresh(comments.slice(0, 1), null, NOW, { owner: OWNER }), false, 'control: without the RECLAIM it is stale');
  assert.equal(claimWinner([c('RELEASE runner=cloud-b', { id: 15 }), ...comments], { owner: OWNER }).runner, 'laptop', 'a RELEASE before any claim does nothing');
  assert.equal(claimWinner([...comments, c('RELEASE runner=cloud-b', { id: 19 })], { owner: OWNER }).runner, 'laptop', 'a non-holder cannot RELEASE');
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
    parsed(45, { deps: [{ kind: 'marker', name: 'lwld-y' }] }, ['cloud-lane', 'blocked']),
  ];
  const plan = housekeepingPlan(issues, [{ head: { ref: 'autopilot/lane-40' } }], { closedIssues: [], openPRs: [{ head: { ref: 'autopilot/lane-44' } }] });
  assert.deepEqual(plan.slice(0, 2), [
    { op: 'addLabel', number: 40, label: 'done' },
    { op: 'close', number: 40, reason: 'completed' },
  ]);
  assert.ok(plan.some((o) => o.number === 42 && o.op === 'addLabel' && o.label === 'ready'), 'a met PR dep unblocks');
  assert.ok(!plan.some((o) => o.number === 41 && o.label === 'ready'), '#41 waits for #40 to be CLOSED, which this run only plans');
  assert.ok(!plan.some((o) => o.number === 43 || o.number === 45), 'an unknown marker flips nothing: the cloud never undoes the laptop');
  const laptopPlan = housekeepingPlan(issues, [], { closedIssues: [], markersMet: ['lwld-y'] });
  assert.ok(laptopPlan.some((o) => o.number === 43 && o.label === 'blocked'), 'the laptop, which reads markers, blocks an unmet one');
  assert.ok(laptopPlan.some((o) => o.number === 45 && o.label === 'ready'), 'and readies a met one');
  assert.ok(plan.some((o) => o.number === 44 && o.label === 'pr-open'));
  assert.equal(housekeepingPlan(issues, [{ head: { ref: 'autopilot/lane-40' } }], {}, { max: 1 }).length, 1);
});

/** A minimal in-memory issue API: comments get increasing ids in the order they land. */
function fakeIssueApi(owner, laneOver = {}) {
  let id = 0;
  const comments = [];
  const labels = new Set();
  const posts = [];
  return {
    owner,
    comments,
    labels,
    posts,
    getIssue: async (n) => ({ number: n, state: 'open', labels: [{ name: 'cloud-lane' }, { name: 'ready' }], ...renderIssue(lane(laneOver)) }),
    addLabels: async (_n, ls) => { posts.push('label'); ls.forEach((l) => labels.add(l)); },
    removeLabel: async (_n, l) => labels.delete(l),
    // Like the REST POST, the new comment comes back (with its id).
    comment: async (_n, body) => { posts.push('comment'); const cm = { id: ++id, body, user: { login: owner }, created_at: new Date(NOW).toISOString() }; comments.push(cm); return { ...cm }; },
    listComments: async () => [...comments],
  };
}

/** A promise every caller waits on until `n` callers have arrived. */
function barrier(n) {
  let arrived = 0;
  let open;
  const gate = new Promise((r) => { open = r; });
  return async () => { if (++arrived >= n) open(); await gate; };
}

/** Two claims raced so both READ before either posts, and both post before either re-reads. */
async function race(api, runnerA, runnerB, opts = {}) {
  const readGate = barrier(2);
  const settleGate = barrier(2);
  const list = api.listComments;
  let reads = 0;
  api.listComments = async (n) => { const got = await list(n); if (++reads <= 2) await readGate(); return got; };
  const o = { sleep: settleGate, now: () => new Date(NOW), ...opts };
  const [a, b] = await Promise.all([claim(api, 1, runnerA, o), claim(api, 1, runnerB, o)]);
  api.listComments = list;
  return [a, b];
}

test('IQ12 claim(): a two-runner race has exactly one winner; the loser yields', async () => {
  const api = fakeIssueApi(OWNER);
  // Both read the issue unclaimed, both post, both settle: the race the settle exists for.
  const [aResult, bResult] = await race(api, 'cloud-a', 'cloud-b');
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

test('IQ14 two claimants with the same runner id race: exactly one wins, by comment id', async () => {
  const api = fakeIssueApi(OWNER);
  const [a, b] = await race(api, CONTRACT.laptopRunner, CONTRACT.laptopRunner);
  assert.deepEqual([a.won, b.won].sort(), [false, true], 'one dispatcher wins, not both');
  assert.equal(api.comments.filter((x) => x.body.startsWith('CLAIM ')).length, 2);
  assert.ok(api.labels.has('claimed:laptop'), 'the loser does not strip the label the winner shares');
  const noId = { ...fakeIssueApi(OWNER), comment: async () => undefined };
  await assert.rejects(claim(noId, 1, 'cloud-a', { sleep: async () => {}, now: () => new Date(NOW) }), /without an id/, 'no comment id: fail closed');
});

test('IQ15 an invalid RECLAIM is a plain claim and loses', async () => {
  const stale = c('CLAIM runner=cloud-a at=x nonce=aaaaaaaa', { id: 100, at: hoursAgo(10) });
  // late: A reclaimed (valid) and launched; B's RECLAIM, from the same stale read, lands after.
  const late = [
    stale,
    c('RECLAIM previous=cloud-a runner=cloud-a2 at=x', { id: 101, at: hoursAgo(1) }),
    c('PROGRESS routine=trig_a2', { id: 102, at: hoursAgo(0.9) }),
    c('RECLAIM previous=cloud-a runner=cloud-b at=x', { id: 103, at: hoursAgo(0.5) }),
  ];
  assert.equal(claimWinner(late, { owner: OWNER }).runner, 'cloud-a2', 'a late RECLAIM does not evict a holder that launched');
  const lateNoLaunch = late.filter((x) => x.id !== 102);
  assert.equal(claimWinner(lateNoLaunch, { owner: OWNER }).runner, 'cloud-a2', 'nor one that reclaimed 30 min earlier');
  const overFresh = [c('CLAIM runner=cloud-a at=x nonce=aaaaaaaa', { id: 110, at: hoursAgo(1.5) }), c('RECLAIM previous=cloud-a runner=cloud-b at=x', { id: 111, at: hoursAgo(0.5) })];
  assert.equal(claimWinner(overFresh, { owner: OWNER }).runner, 'cloud-a', 'a RECLAIM over a 1-hour-old claim is not valid');
  const wrongPrev = [stale, c('RECLAIM previous=somebody-else runner=cloud-b at=x', { id: 104, at: hoursAgo(1) })];
  assert.equal(claimWinner(wrongPrev, { owner: OWNER }).runner, 'cloud-a', 'previous= must name the holder');
  const launched = [stale, c('PROGRESS routine=trig_a', { id: 105, at: hoursAgo(9) }), c('RECLAIM previous=cloud-a runner=cloud-b at=x', { id: 106, at: hoursAgo(1) })];
  assert.equal(claimWinner(launched, { owner: OWNER }).runner, 'cloud-a', 'a holder with a launch record is never reclaimed');
  const st = claimState(launched.slice(0, 2), { owner: OWNER, now: NOW });
  assert.deepEqual([st.fresh, st.launched, st.reclaimable], [false, true, false]);
  // control: the same RECLAIM over the stale, never-launched holder is valid
  assert.equal(claimWinner([stale, c('RECLAIM previous=cloud-a runner=cloud-b at=x', { id: 107, at: hoursAgo(1) })], { owner: OWNER }).runner, 'cloud-b');
  // two concurrent valid reclaims of one holder: the lower id wins, as claims do
  const both = [stale, c('RECLAIM previous=cloud-a runner=cloud-b at=x', { id: 108, at: hoursAgo(1) }), c('RECLAIM previous=cloud-a runner=cloud-c at=x', { id: 109, at: hoursAgo(1) })];
  assert.equal(claimWinner(both, { owner: OWNER }).runner, 'cloud-b');
});

test('IQ16 nextReady and claim() agree on a stale lane', async () => {
  const api = fakeIssueApi(OWNER);
  api.comments.push({ id: 0, body: 'CLAIM runner=cloud-a at=x nonce=aaaaaaaa', user: { login: OWNER }, created_at: hoursAgo(10) });
  const issue = parsed(50, {}, undefined, api.comments);
  const [offered] = nextReady([issue], { owner: OWNER, now: NOW, closedIssues: [], mergedBranches: [], openPRs: [] });
  assert.equal(offered?.number, 50, 'the stale-claimed lane is offered');
  const [a, b] = await race(api, 'cloud-b', 'cloud-c', { prUpdatedAt: offered.prUpdatedAt });
  assert.equal(a.won, true, 'claim() takes the stale lane by RECLAIM, without a caller-supplied holder');
  assert.equal(b.won, false);
  assert.match(api.comments[1].body, /^RECLAIM previous=cloud-a runner=cloud-b at=/);
  assert.deepEqual(nextReady([parsed(50, {}, undefined, [...api.comments])], { owner: OWNER, now: NOW, openPRs: [] }), [], 'and it is not offered again');
  // a fresh holder: claim() refuses without writing anything
  const fresh = fakeIssueApi(OWNER);
  fresh.comments.push({ id: 0, body: 'CLAIM runner=cloud-a at=x nonce=aaaaaaaa', user: { login: OWNER }, created_at: hoursAgo(1) });
  const r = await claim(fresh, 1, 'cloud-b', { sleep: async () => {}, now: () => new Date(NOW) });
  assert.deepEqual([r.won, r.posted, fresh.comments.length], [false, false, 1]);
  // launched and stale: neither offered nor taken
  const gone = fakeIssueApi(OWNER);
  gone.comments.push({ id: 0, body: 'CLAIM runner=cloud-a at=x nonce=aaaaaaaa', user: { login: OWNER }, created_at: hoursAgo(10) },
    { id: 1, body: 'PROGRESS routine=trig_a', user: { login: OWNER }, created_at: hoursAgo(9) });
  assert.deepEqual(nextReady([parsed(51, {}, undefined, gone.comments)], { owner: OWNER, now: NOW, openPRs: [] }), []);
  const g = await claim(gone, 1, 'cloud-b', { sleep: async () => {}, now: () => new Date(NOW) });
  assert.deepEqual([g.won, g.posted, gone.comments.length], [false, false, 2]);
});

test('IQ17 a migration stub is never readied, offered or launchable', () => {
  const stub = parsed(60, { deps: [{ kind: 'marker', name: MIGRATION_STUB_MARKER }], prompt: MIGRATION_STUB_PROMPT }, ['cloud-lane', 'blocked']);
  assert.deepEqual(housekeepingPlan([stub], [], { markersMet: [MIGRATION_STUB_MARKER] }), [], 'housekeeping never flips a stub to ready');
  const placeholderOnly = parsed(61, { prompt: MIGRATION_STUB_PROMPT }, ['cloud-lane', 'blocked']);
  assert.deepEqual(housekeepingPlan([placeholderOnly], []), [], 'the placeholder prompt alone is enough to refuse');
  const readied = parsed(62, { prompt: MIGRATION_STUB_PROMPT }, ['cloud-lane', 'ready']);
  assert.deepEqual(nextReady([readied], { owner: OWNER, now: NOW, openPRs: [] }), [], 'a stub someone labelled ready is still not offered');
  assert.throws(() => assertLaunchable(readied), /migration stub/);
  assert.throws(() => assertLaunchable(parsed(63, { prompt: '  ' })), /empty/);
  assert.equal(assertLaunchable(parsed(64)).number, 64, 'control: a real lane is launchable');
  assert.equal(housekeepingPlan([parsed(65, {}, ['cloud-lane', 'blocked'])], []).length, 2, 'control: a real blocked lane with deps met is readied');
});

test('IQ18 fail closed on a missing comments array; free text is not a protocol line', () => {
  const noComments = { ...parsed(70), comments: undefined };
  assert.throws(() => nextReady([noComments], { owner: OWNER, now: NOW }), /no comments array/);
  for (const body of ['PROGRESS looks slow, checking', 'RELEASE notes are up', 'CLAIM runner=x', 'YIELD runner=a extra', 'RECLAIM runner=b at=x', 'PROGRESS note=1']) {
    assert.equal(parseEvent(c(body)), null, body);
  }
  const seven = [c('CLAIM runner=cloud-a at=x nonce=12345678', { at: hoursAgo(7) }), c('PROGRESS looks slow, checking', { at: hoursAgo(1) })];
  assert.equal(claimFresh(seven, null, NOW, { owner: OWNER }), false, 'a free-text comment keeps no claim alive');
  for (const body of ['CLAIM runner=laptop at=2026-10-02T12:00:00.000Z nonce=0a1b2c3d', 'YIELD runner=cloud-a', 'RELEASE runner=cloud-a', 'RECLAIM previous=cloud-a runner=laptop at=x', 'PROGRESS routine=trig_1 pr=12']) {
    assert.ok(parseEvent(c(body)), `control: ${body}`);
  }
});

test('IQ19 another claimant\'s losing line never keeps a dead holder fresh (review of #1163, minor 1)', () => {
  // The review's repro: the holder's CLAIM at T0; a claimant whose local clock runs ahead
  // posts a RECLAIM that lands, by the server's clock, 10 s short of stale.
  const T0 = NOW - 6 * 3600_000 - 60_000;
  const at = (ms) => new Date(ms).toISOString();
  const comments = [
    c('CLAIM runner=cloud-a at=x nonce=aaaaaaaa', { id: 200, at: at(T0) }),
    c('RECLAIM previous=cloud-a runner=cloud-b at=x', { id: 201, at: at(T0 + 6 * 3600_000 - 10_000) }),
  ];
  const st = claimState(comments, { owner: OWNER, now: NOW });
  assert.equal(st.holder.runner, 'cloud-a', 'the early RECLAIM is invalid and does not take the lane');
  assert.deepEqual([st.fresh, st.reclaimable], [false, true], 'the holder is stale by its own clock, so a valid RECLAIM may now take it');
  // a losing CLAIM in the same window is the same: not the holder's activity
  const losing = [comments[0], c('CLAIM runner=cloud-c at=x nonce=cccccccc', { id: 202, at: hoursAgo(1) })];
  assert.deepEqual([claimState(losing, { owner: OWNER, now: NOW }).fresh, claimState(losing, { owner: OWNER, now: NOW }).reclaimable], [false, true]);
  // control: the HOLDER's own later line is activity and keeps it fresh
  const own = [comments[0], c('CLAIM runner=cloud-a at=x nonce=bbbbbbbb', { id: 203, at: hoursAgo(1) })];
  assert.equal(claimState(own, { owner: OWNER, now: NOW }).fresh, true);
});

test('IQ20 claim() refuses a migration stub or an empty prompt before any write (review of #1163, nit 3)', async () => {
  const stub = fakeIssueApi(OWNER, { deps: [{ kind: 'marker', name: MIGRATION_STUB_MARKER }], prompt: MIGRATION_STUB_PROMPT });
  await assert.rejects(claim(stub, 7, 'cloud-b', { sleep: async () => {}, now: () => new Date(NOW) }), /migration stub/);
  assert.deepEqual([stub.posts, stub.comments.length, [...stub.labels]], [[], 0, []], 'a stub: no label, no comment');
  const empty = fakeIssueApi(OWNER, { prompt: '   ' });
  await assert.rejects(claim(empty, 8, 'cloud-b', { sleep: async () => {}, now: () => new Date(NOW) }), /the prompt is empty/);
  assert.deepEqual([empty.posts, empty.comments.length], [[], 0], 'an empty prompt: nothing written');
  // control: a real lane is claimed
  const real = fakeIssueApi(OWNER);
  const r = await claim(real, 9, 'cloud-b', { sleep: async () => {}, now: () => new Date(NOW) });
  assert.equal(r.won, true);
});
