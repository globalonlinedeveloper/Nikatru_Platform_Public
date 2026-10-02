// autopilot-land-gate.test.mjs — what the autopilot lanes added to the lander's
// eligibility (tooling/ci/land-next.mjs): the independent-review gate (lane
// autopilot-reviews, O-REVIEWS-DEPEND-ON-THE-LAPTOP) and fix-first during a freeze (lane
// autopilot-fixer, O-FREEZE-FIX-NEEDS-THE-LAPTOP): the freeze issue's log section, the
// fix-first eligibility and the auto-close. Each case is the input that would land (or
// unfreeze) the wrong thing.
//
// Run:  node --test "tooling/ci/test/autopilot-land-gate.test.mjs"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decidePr, reviewVerdict, plan, report, mainWatch, stripAnsi, freezeLogSection, freezeJobs, freezeCloseVerdict, LAND_LABEL, HOLD_LABEL, NEEDS_REVIEW_LABEL, APPROVE_LABEL, FIX_FIRST_LABEL, FREEZE_LOG_CAP } from '../land-next.mjs';

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

describe('fix-first: the freeze issue carries what a fixer needs', () => {
  test('🔴 ANSI is stripped; each job keeps its LAST 60 lines and names its first failing step', () => {
    const log = Array.from({ length: 100 }, (_, i) => `\u001b[31mline ${i}\u001b[0m`).join('\r\n');
    assert.equal(stripAnsi('\u001b[1;31mred\u001b[0m plain'), 'red plain');
    const out = freezeLogSection([{ name: 'guard-meta', step: 'ops register', log }, { name: 'web', step: null, log: null }]);
    assert.doesNotMatch(out, /\u001b/);
    assert.match(out, /### `guard-meta` — first failing step: `ops register`/);
    assert.match(out, /line 99\n```/);
    assert.match(out, /line 40\n/);
    assert.doesNotMatch(out, /line 39\n/);
    assert.match(out, /### `web` — first failing step: not named by the API\n\n_the log could not be read_/);
  });
  test('🔴 the cap: at most 20,000 characters in total, cutting each tail’s OLDEST lines', () => {
    const big = Array.from({ length: 60 }, (_, i) => `${i} ${'x'.repeat(400)}`).join('\n');
    const out = freezeLogSection([{ name: 'a', step: 's', log: big }, { name: 'b', step: 's', log: big }]);
    assert.ok(out.length <= FREEZE_LOG_CAP, `${out.length}`);
    assert.match(out, /59 x+\n```/, 'the newest line survives');
    assert.match(out, /### `b`/, 'every job is still named');
  });
  test('🔴 the body names every NEW failing job (and carries them as a marker the close reads)', () => {
    const w = mainWatch({ main: { sha: sha('a'), parentSha: sha('b'), committedAt: '2026-10-02T08:00:00Z' }, runs: [{ id: 9, path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: sha('a'), status: 'completed', conclusion: 'failure', html_url: 'https://x/9' }], failedJobs: { 9: ['web', 'guard-meta', 'old'] }, baseline: { '.github/workflows/ci.yml': ['old'] }, now: Date.parse('2026-10-02T09:00:00Z') });
    assert.equal(w.state, 'FREEZE');
    assert.deepEqual(freezeJobs(w.freeze.body), ['guard-meta', 'web']);
    assert.match(w.freeze.body, /`guard-meta`, `web`/);
    assert.match(w.freeze.body, new RegExp(sha('a')));
    assert.deepEqual(freezeJobs('failing job(s) new against the parent: `x`, `y`'), ['x', 'y'], 'an older body without the marker');
  });
});

describe('fix-first: only the fix merges during a freeze', () => {
  const FREEZE = { number: 50, state: 'open', body: '<!-- land-freeze run=9 -->\n<!-- land-freeze-jobs ["web"] -->' };
  const snap = (prs, over = {}) => ({
    repo: R,
    now: '2026-10-02T09:00:00Z',
    main: { sha: sha('a'), parentSha: sha('b'), committedAt: '2026-10-02T08:00:00Z' },
    mainRuns: [{ id: 9, path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: sha('a'), status: 'completed', conclusion: 'failure' }],
    failedJobs: { 9: ['web'] },
    baseline: { '.github/workflows/ci.yml': [] },
    freezes: [FREEZE],
    freezeMarkers: ['<!-- land-freeze run=9 -->'],
    units: { web: ['apps/**'] },
    prs,
    ...over,
  });
  const fix = (over = {}) => pr({ number: 11, labels: [LAND_LABEL, FIX_FIRST_LABEL], body: 'Rows: x\nDeploys: none\nFixes-freeze: #50\nLane-runner: fixer', ...over });
  test('the fix-first PR naming the open freeze MERGES', () => {
    const p = plan(snap([pr({ number: 7 }), fix()]));
    assert.equal(p.act?.kind, 'merge', report(p, { dryRun: true }).join('\n'));
    assert.equal(p.act.pr.number, 11);
  });
  test('🔴 a non-fix PR during a freeze → WAIT (and nothing merges)', () => {
    const p = plan(snap([pr({ number: 7 })]));
    assert.equal(p.act, null);
    assert.equal(p.decisions[0].action, 'WAIT');
    assert.match(p.decisions[0].why, /frozen by #50/);
  });
  test('🔴 a fix naming ANOTHER issue → WAIT; a label without the line → WAIT', () => {
    assert.equal(plan(snap([fix({ body: 'Fixes-freeze: #49' })])).act, null);
    assert.equal(plan(snap([fix({ body: 'fixes the freeze' })])).act, null);
    assert.equal(plan(snap([fix({ labels: [LAND_LABEL] })])).act, null);
  });
  test('🔴 a fix that is not green → WAIT; a fix still needs its review when review-classed', () => {
    assert.equal(plan(snap([fix({ checks: [] })])).act, null);
    assert.equal(plan(snap([fix({ labels: [LAND_LABEL, FIX_FIRST_LABEL, NEEDS_REVIEW_LABEL] })])).act, null);
  });
  test('no freeze → fix-first makes no difference', () => {
    const p = plan(snap([fix({ number: 7, labeledAt: '2026-10-02T07:00:00Z' }), pr({ number: 8, labeledAt: '2026-10-02T06:00:00Z' })], { freezes: [], mainRuns: [{ id: 9, path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: sha('a'), status: 'completed', conclusion: 'success' }], failedJobs: {} }));
    assert.equal(p.act.pr.number, 8, 'queue order, not the label');
  });
});

describe('fix-first: the freeze closes itself when main is green again', () => {
  const freeze = { number: 50, body: '<!-- land-freeze-jobs ["web","guard-meta"] -->' };
  const check = (jobs, over = {}) => ({ runId: 12, url: 'https://x/12', status: 'completed', conclusion: 'success', jobs: Object.entries(jobs).map(([name, conclusion]) => ({ name, conclusion })), baseline: [], ...over });
  test('the named jobs green → closed, with the run link', () => {
    const v = freezeCloseVerdict({ freeze, check: check({ web: 'success', 'guard-meta': 'success', other: 'success' }) });
    assert.equal(v.close, true, v.why);
    assert.match(v.comment, /https:\/\/x\/12/);
  });
  test('🔴 a green run MISSING (or skipping) a named job → stays open', () => {
    assert.equal(freezeCloseVerdict({ freeze, check: check({ web: 'success' }) }).close, false);
    assert.equal(freezeCloseVerdict({ freeze, check: check({ web: 'success', 'guard-meta': 'skipped' }) }).close, false);
  });
  test('🔴 another job red that was already red on the parent → still closes; a NEW red → stays open', () => {
    assert.equal(freezeCloseVerdict({ freeze, check: check({ web: 'success', 'guard-meta': 'success', old: 'failure' }, { conclusion: 'failure', baseline: ['old'] }) }).close, true);
    assert.equal(freezeCloseVerdict({ freeze, check: check({ web: 'success', 'guard-meta': 'success', fresh: 'failure' }, { conclusion: 'failure', baseline: ['old'] }) }).close, false);
    assert.equal(freezeCloseVerdict({ freeze, check: check({ web: 'success', 'guard-meta': 'success', old: 'failure' }, { baseline: null }) }).close, false, 'no baseline → fail closed');
  });
  test('🔴 a run still going, or none read → stays open', () => {
    assert.equal(freezeCloseVerdict({ freeze, check: check({}, { status: 'in_progress' }) }).close, false);
    assert.equal(freezeCloseVerdict({ freeze, check: null }).close, false);
  });
  test('the plan closes it (one write) before any merge', () => {
    const p = plan({
      repo: R, now: '2026-10-02T09:00:00Z', main: { sha: sha('a'), parentSha: sha('b'), committedAt: '2026-10-02T08:00:00Z' },
      mainRuns: [{ id: 12, path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: sha('a'), status: 'completed', conclusion: 'success' }],
      failedJobs: {}, baseline: {}, freezes: [{ ...freeze, state: 'open' }], freezeMarkers: [], units: { web: ['apps/**'] },
      freezeCheck: check({ web: 'success', 'guard-meta': 'success' }), prs: [pr({ number: 7 })],
    });
    assert.equal(p.act.kind, 'close-freeze');
    assert.equal(p.act.issue, 50);
  });
});
