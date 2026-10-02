// autopilot-land-gate.test.mjs — what the autopilot lanes added to the lander's
// eligibility (tooling/ci/land-next.mjs): the independent-review gate (lane
// autopilot-reviews, O-REVIEWS-DEPEND-ON-THE-LAPTOP). Each case is the input that would
// land the wrong thing.
//
// Run:  node --test "tooling/ci/test/autopilot-land-gate.test.mjs"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decidePr, reviewVerdict, LAND_LABEL, HOLD_LABEL, NEEDS_REVIEW_LABEL, APPROVE_LABEL } from '../land-next.mjs';

const R = 'o/r';
const sha = (c) => c.repeat(40);
const HEAD = sha('c');
const OLD_HEAD = sha('d');
const gate = (run) => ({ name: 'ci-gate', status: 'completed', conclusion: 'success', details_url: `https://github.com/${R}/actions/runs/${run}/job/1` });
const pr = (over = {}) => ({
  number: 7,
  state: 'open',
  draft: false,
  labels: [LAND_LABEL],
  baseRef: 'main',
  headSha: HEAD,
  headRef: 'feat/x',
  headRepo: R,
  mergeable: true,
  mergeableState: 'clean',
  checks: [gate(100)],
  runs: [{ id: 100, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', head_sha: HEAD }],
  e2eRuns: [],
  files: ['tooling/ci/x.mjs'],
  filesComplete: true,
  behindBy: 0,
  mainFiles: [],
  reviews: [],
  ...over,
});
const verdict = (id, v, over = {}) => ({ id, author_association: 'OWNER', body: `VERDICT: ${v}\nHead: ${HEAD}\n- finding`, commit_id: HEAD, submitted_at: `2026-10-02T10:0${id % 10}:00Z`, state: 'COMMENTED', ...over });
const decide = (over) => decidePr(pr(over), { repo: R, units: { web: ['apps/**'] } });
const REVIEWED = [LAND_LABEL, NEEDS_REVIEW_LABEL, APPROVE_LABEL];

describe('the review gate', () => {
  test('the labels come from the contract', () => {
    assert.deepEqual([HOLD_LABEL, NEEDS_REVIEW_LABEL, APPROVE_LABEL], ['land-hold', 'needs-review', 'review:approve']);
  });
  test('an owner APPROVE on the head + `review:approve` → eligible (MERGE)', () => {
    const d = decide({ labels: REVIEWED, reviews: [verdict(1, 'APPROVE')] });
    assert.equal(d.action, 'MERGE', d.why);
    assert.match(d.why, /owner APPROVE on cccccccc \(review 1\)/);
  });
  test('🔴 an APPROVE on an OLDER head → WAIT', () => {
    const d = decide({ labels: REVIEWED, reviews: [verdict(1, 'APPROVE', { commit_id: OLD_HEAD })] });
    assert.equal(d.action, 'WAIT');
    assert.match(d.why, /on dddddddd, not the head cccccccc/);
  });
  test('🔴 an APPROVE by a NON-owner → WAIT (anyone can post a COMMENT review on a public repo)', () => {
    const d = decide({ labels: REVIEWED, reviews: [verdict(1, 'APPROVE', { author_association: 'NONE' }), verdict(2, 'APPROVE', { author_association: 'CONTRIBUTOR' })] });
    assert.equal(d.action, 'WAIT');
    assert.match(d.why, /no owner verdict yet \(2 verdict-shaped review\(s\) by a non-owner ignored\)/);
  });
  test('🔴 a non-owner CHANGES cannot block an owner APPROVE either', () => {
    const d = decide({ labels: REVIEWED, reviews: [verdict(1, 'APPROVE'), verdict(2, 'CHANGES', { author_association: 'NONE' })] });
    assert.equal(d.action, 'MERGE', d.why);
  });
  test('🔴 `land-hold` → WAIT, even fully approved', () => {
    const d = decide({ labels: [...REVIEWED, HOLD_LABEL], reviews: [verdict(1, 'APPROVE')] });
    assert.equal(d.action, 'WAIT');
    assert.match(d.why, /land-hold/);
  });
  test('🔴 CHANGES → WAIT; a NEWER CHANGES on the same head beats an older APPROVE', () => {
    assert.equal(decide({ labels: REVIEWED, reviews: [verdict(1, 'CHANGES')] }).action, 'WAIT');
    const d = decide({ labels: REVIEWED, reviews: [verdict(1, 'APPROVE'), verdict(2, 'CHANGES')] });
    assert.equal(d.action, 'WAIT');
    assert.match(d.why, /newest verdict on cccccccc is CHANGES \(review 2\)/);
    assert.equal(decide({ labels: REVIEWED, reviews: [verdict(1, 'CHANGES'), verdict(2, 'APPROVE')] }).action, 'MERGE', 'a newer APPROVE wins back');
  });
  test('🔴 an APPROVE without the `review:approve` label, or with none at all → WAIT', () => {
    assert.equal(decide({ labels: [LAND_LABEL, NEEDS_REVIEW_LABEL], reviews: [verdict(1, 'APPROVE')] }).action, 'WAIT');
    assert.equal(decide({ labels: REVIEWED, reviews: [] }).action, 'WAIT');
  });
  test('🔴 a review whose FIRST line is not the verdict is not a verdict', () => {
    const d = decide({ labels: REVIEWED, reviews: [verdict(1, 'APPROVE', { body: `Looks fine.\nVERDICT: APPROVE` })] });
    assert.equal(d.action, 'WAIT');
  });
  test('a PR without `needs-review` behaves exactly as before (reviews are not read)', () => {
    assert.equal(decide({}).action, 'MERGE');
    assert.equal(decide({ reviews: [verdict(1, 'CHANGES')] }).action, 'MERGE');
    assert.equal(decide({ labels: [] }).action, 'SKIP', 'no land-ok is still a skip');
  });
  test('reviewVerdict orders by submission time, then id', () => {
    const r = reviewVerdict({ reviews: [verdict(9, 'CHANGES', { submitted_at: '2026-10-02T09:00:00Z' }), verdict(3, 'APPROVE', { submitted_at: '2026-10-02T11:00:00Z' })], headSha: HEAD, labels: REVIEWED });
    assert.equal(r.ok, true, r.why);
  });
});
