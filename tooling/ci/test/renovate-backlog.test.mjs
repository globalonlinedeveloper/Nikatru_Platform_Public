// -----------------------------------------------------------------------------
// renovate-backlog.test.mjs - the Renovate queue is judged from the dashboard's
// MARKERS and its edit history, and "I could not look" is never a pass.
//
// tooling/ops/check-renovate-backlog.mjs is limb 3 of row
// O-RENOVATE-BACKLOG-OUTRUNS-ITS-LIMITS. Measured 2026-09-22: #417 held 21
// waiting updates, the oldest 19 days old, while every renovate.yml run was green.
//
//   R0 GREEN CONTROL - a short, young queue passes and SAYS its numbers
//   G1 the waiting count above maxWaiting -> exit 1
//   G2 the oldest entry older than maxOldestDays -> exit 1
//   G3 the heading renamed "Rate-Limited" <-> "Awaiting Schedule" -> still counted
//   G4 an unreadable dashboard -> exit 2 (COVERAGE LOST), never green:
//      wrong title, closed issue, empty body, a grammar change, an empty history,
//      an age that is only a lower bound, a refused or dropped read, no token
//   F1 the committed floor file is valid, and RED on the measured 2026-09-22 state
//   A1 the reader joins the ops-bounded-retry adoption sweep (vacuous-10)
//   G5 (in an enforcing host a backlog verdict prints and does not block) is NOT
//      here: it depends on the wiring decision recorded in the lane notes.
//
// Run:  node --test tooling/ci/test/renovate-backlog.test.mjs
// -----------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  judge,
  readFloor,
  readDashboard,
  waitingEntries,
  CouldNotLook,
  DAY_MS,
} from '../../ops/check-renovate-backlog.mjs';
import { READ_ATTEMPTS } from '../../ops/bounded-retry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPS = resolve(HERE, '..', '..', 'ops');
const SCRIPT = join(OPS, 'check-renovate-backlog.mjs');
const FLOOR = { issue: 417, maxWaiting: 15, maxOldestDays: 14 };
const NOW = Date.parse('2026-09-22T12:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY_MS).toISOString();

function body(branches, { heading = 'Awaiting Schedule', kind = 'unschedule-branch', createAll = true } = {}) {
  return [
    'This issue lists Renovate updates and detected dependencies.',
    '',
    `## ${heading}`,
    '',
    'The following updates are awaiting their schedule.',
    '',
    ...branches.map((b) => ` - [ ] <!-- ${kind}=${b} -->chore(deps): update ${b}`),
    ...(createAll ? [' - [ ] <!-- create-all-awaiting-schedule-prs -->**Create all awaiting schedule PRs at once**'] : []),
    '',
    '## Detected Dependencies',
    '',
  ].join('\n');
}

/** An issue whose history shows each branch joining `daysAgo` before NOW. */
function issueWith(joined, opts = {}) {
  const branches = Object.keys(joined);
  const times = [...new Set(Object.values(joined))].sort((a, b) => a - b); // youngest first
  const revisions = times.map((t) => ({ editedAt: iso(t), diff: body(branches.filter((b) => joined[b] >= t), opts) }));
  // One revision older than every join, listing none of them: the history is complete.
  const oldest = Math.max(0, ...times) + 1;
  revisions.push({ editedAt: iso(oldest), diff: body([], { ...opts, createAll: false }) });
  return {
    title: 'Dependency Dashboard',
    state: 'OPEN',
    body: body(branches, opts),
    updatedAt: iso(Math.min(...times, 0)),
    userContentEdits: { totalCount: revisions.length, nodes: revisions },
  };
}

const many = (n, daysAgo) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`chore/renovate-dep-${i}`, daysAgo]));

describe('R0 green control', () => {
  test('a short, young queue is exit 0 and prints its count and oldest age', () => {
    const v = judge({ issue: issueWith({ 'chore/renovate-a': 1, 'chore/renovate-b': 3 }), floor: FLOOR, now: NOW });
    assert.equal(v.code, 0, v.lines.join('\n'));
    assert.match(v.lines[0], /^ok {2}renovate queue 2 <= 15, oldest 3d <= 14d/);
  });
  test('an empty queue with no waiting section is exit 0, not a lookup failure', () => {
    const issue = { title: 'Dependency Dashboard', state: 'OPEN', body: '## Detected Dependencies\n', updatedAt: iso(0), userContentEdits: { totalCount: 0, nodes: [] } };
    assert.equal(judge({ issue, floor: FLOOR, now: NOW }).code, 0);
  });
});

describe('G1 / G2 - the ceilings bite', () => {
  test('G1 16 waiting against a ceiling of 15 is exit 1, and names the count', () => {
    const v = judge({ issue: issueWith(many(16, 2)), floor: FLOOR, now: NOW });
    assert.equal(v.code, 1);
    assert.match(v.lines.join('\n'), /THE RENOVATE QUEUE IS 16 UPDATES, past its ceiling of 15/);
  });
  test('G1 boundary: exactly 15 is still green', () => {
    assert.equal(judge({ issue: issueWith(many(15, 2)), floor: FLOOR, now: NOW }).code, 0);
  });
  test('G2 one entry 15 days old against 14 is exit 1, and names the branch', () => {
    const v = judge({ issue: issueWith({ 'chore/renovate-young': 2, 'chore/renovate-old': 15 }), floor: FLOOR, now: NOW });
    assert.equal(v.code, 1);
    const text = v.lines.join('\n');
    assert.match(text, /1 UPDATE\(S\) HAVE WAITED LONGER THAN 14 DAYS/);
    assert.match(text, /15\.0d {2}chore\/renovate-old/);
  });
  test('G2 an entry that LEFT the queue and came back is aged from its return, not its first sighting', () => {
    const issue = issueWith({ 'chore/renovate-back': 2 });
    // An old revision that listed it, separated from today by the revision that did not.
    issue.userContentEdits.nodes.push({ editedAt: iso(30), diff: body(['chore/renovate-back']) });
    issue.userContentEdits.totalCount += 1;
    assert.equal(judge({ issue, floor: FLOOR, now: NOW }).code, 0);
  });
});

describe('G3 - the heading moves, the count does not', () => {
  // One declaration per case, never a loop: assert-no-loop-cases.mjs L1.
  const joined = { 'chore/renovate-a': 1, 'chore/renovate-b': 2, 'chore/renovate-c': 3 };
  const countsThree = (heading, kind) => () => {
    const v = judge({ issue: issueWith(joined, { heading, kind }), floor: FLOOR, now: NOW });
    assert.equal(v.code, 0, v.lines.join('\n'));
    assert.equal(v.measured.waiting, 3);
    assert.deepEqual(v.measured.headings, [heading]);
  };
  test('"Awaiting Schedule" holding unschedule-branch markers counts 3', countsThree('Awaiting Schedule', 'unschedule-branch'));
  test('"Rate-Limited" holding unlimit-branch markers counts 3', countsThree('Rate-Limited', 'unlimit-branch'));
  test('"Rate-Limited" holding unschedule-branch markers counts 3', countsThree('Rate-Limited', 'unschedule-branch'));
  test('"Awaiting Schedule" holding unlimit-branch markers counts 3', countsThree('Awaiting Schedule', 'unlimit-branch'));
  test('a heading Renovate has not used yet still counts 3', countsThree('A heading Renovate has not used yet', 'unschedule-branch'));
  test('"Pending Approval" holding approve-branch markers counts 3', countsThree('Pending Approval', 'approve-branch'));
  test('open-PR and closed-PR markers are NOT waiting', () => {
    const b = [' - [ ] <!-- rebase-branch=chore/renovate-open -->x', ' - [ ] <!-- recreate-branch=chore/renovate-closed -->y'].join('\n');
    assert.equal(waitingEntries(b).length, 0);
  });
});

describe('G4 - could not look is exit 2, never green', () => {
  const good = () => issueWith({ 'chore/renovate-a': 1 });
  test('a title that is not a Dependency Dashboard', () => {
    assert.equal(judge({ issue: { ...good(), title: 'Something else' }, floor: FLOOR, now: NOW }).code, 2);
  });
  test('a closed dashboard issue', () => {
    assert.equal(judge({ issue: { ...good(), state: 'CLOSED' }, floor: FLOOR, now: NOW }).code, 2);
  });
  test('an empty body', () => {
    assert.equal(judge({ issue: { ...good(), body: '' }, floor: FLOOR, now: NOW }).code, 2);
  });
  test('a waiting section with a create-all box but no marker that parses (the grammar changed)', () => {
    const changed = body(['chore/renovate-a']).replace('<!-- unschedule-branch=', '<!-- wait-branch=');
    const v = judge({ issue: { ...good(), body: changed }, floor: FLOOR, now: NOW });
    assert.equal(v.code, 2);
    assert.match(v.lines[0], /no waiting marker parsed/);
  });
  test('waiting entries with an empty edit history', () => {
    const issue = { ...good(), userContentEdits: { totalCount: 0, nodes: [] } };
    assert.equal(judge({ issue, floor: FLOOR, now: NOW }).code, 2);
  });
  test('an age that is only a lower bound under the ceiling', () => {
    const issue = good();
    issue.userContentEdits.nodes.pop(); // drop the revision that proved where the run starts
    issue.userContentEdits.totalCount = 99; // and say more revisions exist than were read
    const v = judge({ issue, floor: FLOOR, now: NOW });
    assert.equal(v.code, 2);
    assert.match(v.lines.join('\n'), /only a lower bound/);
  });
  test('a lower bound ALREADY past the ceiling is a finding, not a lookup failure', () => {
    const issue = issueWith({ 'chore/renovate-a': 20 });
    issue.userContentEdits.nodes.pop();
    issue.userContentEdits.totalCount = 99;
    assert.equal(judge({ issue, floor: FLOOR, now: NOW }).code, 1);
  });
  test('HTTP 401 is an ANSWER: CouldNotLook on first sight, asked once', async () => {
    let n = 0;
    const doFetch = async () => {
      n += 1;
      return new Response('{"message":"Bad credentials"}', { status: 401 });
    };
    await assert.rejects(readDashboard({ owner: 'o', name: 'r', number: 417, token: 't', doFetch, sleep: async () => {} }), CouldNotLook);
    assert.equal(n, 1);
  });
  test('a dropped wire on every attempt is CouldNotLook after the bounded plan', async () => {
    let n = 0;
    const doFetch = async () => {
      n += 1;
      throw new TypeError('fetch failed');
    };
    await assert.rejects(readDashboard({ owner: 'o', name: 'r', number: 417, token: 't', doFetch, sleep: async () => {} }), CouldNotLook);
    assert.equal(n, READ_ATTEMPTS);
  });
  test('GraphQL errors in a 200 are CouldNotLook, even beside partial data', async () => {
    const payload = JSON.stringify({ data: { repository: { issue: good() } }, errors: [{ message: 'userContentEdits: timeout' }] });
    const doFetch = async () => new Response(payload, { status: 200 });
    await assert.rejects(readDashboard({ owner: 'o', name: 'r', number: 417, token: 't', doFetch, sleep: async () => {} }), CouldNotLook);
  });
  test('one blip then an answer is read', async () => {
    let n = 0;
    const payload = JSON.stringify({ data: { repository: { issue: good() } } });
    const doFetch = async () => (n++ === 0 ? new Response('busy', { status: 502 }) : new Response(payload, { status: 200 }));
    const issue = await readDashboard({ owner: 'o', name: 'r', number: 417, token: 't', doFetch, sleep: async () => {} });
    assert.equal(issue.title, 'Dependency Dashboard');
  });
  test('no token: the process exits 2 and says the dashboard was not read', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' } });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /#417 was not read/);
  });
});

describe('F1 - the committed floor', () => {
  const raw = readFileSync(join(OPS, 'renovate-backlog-floor.json'), 'utf8');
  const floor = readFloor(raw);
  const file = JSON.parse(raw);
  test('it is valid, and each ceiling carries a basis', () => {
    assert.equal(floor.error, undefined, floor.error);
    assert.equal(floor.issue, 417);
  });
  test('no ceiling sits below 0.7 x its measurement', () => {
    assert.ok(floor.maxWaiting >= 0.7 * file.measured.waiting);
    assert.ok(floor.maxOldestDays >= 0.7 * file.measured.oldestDays);
  });
  test('it is RED on the measured state it was written against (21 waiting, oldest 19 days)', () => {
    const joined = many(file.measured.waiting, 2);
    joined['chore/renovate-dep-0'] = file.measured.oldestDays;
    const v = judge({ issue: issueWith(joined), floor, now: NOW });
    assert.equal(v.code, 1, v.lines.join('\n'));
  });
  test('a ceiling without its basis is refused', () => {
    const bad = JSON.parse(raw);
    delete bad.maxWaiting.basis;
    assert.match(readFloor(bad).error, /basis is missing/);
  });
});

describe('A1 - the reader is inside the adoption sweep (vacuous-10)', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  test('it imports the shared plan and CALLS it', () => {
    assert.match(src, /from '\.\/bounded-retry\.mjs'/);
    assert.match(src, /\breadWithBoundedRetry\s*\(/);
  });
  test('its network call is spelled doFetch( - the spelling ops-bounded-retry B8 matches', () => {
    assert.match(src, /\bdoFetch\s*\(/);
    assert.match(src, /process\.exitCode/);
  });
  test('process.exit() is not called (comments excluded: the header names the ban)', () => {
    const code = src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.equal(/process\.exit\(/.test(code), false);
  });
});
