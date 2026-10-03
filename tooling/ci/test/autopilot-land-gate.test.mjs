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
import { decidePr, readSnapshot, reviewVerdict, reviewRequired, verdictOf, unionFreezeChecks, plan, report, mainWatch, stripAnsi, freezeLogSection, freezeJobs, freezeCloseVerdict, LAND_LABEL, HOLD_LABEL, NEEDS_REVIEW_LABEL, APPROVE_LABEL, FIX_FIRST_LABEL, FREEZE_LOG_CAP } from '../land-next.mjs';

const R = 'o/r';
const sha = (c) => c.repeat(40);
const HEAD = sha('c');
const OLD_HEAD = sha('d');
// The approval binds to one head (land-next's `land-ok:<sha8>`, review of #1169): every
// eligible fixture carries the label bound to HEAD, applied before any force-push.
const LAND = `${LAND_LABEL}:${HEAD.slice(0, 8)}`;
const LABEL_AT = '2026-10-02T08:00:00Z';
const gate = (run) => ({ name: 'ci-gate', status: 'completed', conclusion: 'success', details_url: `https://github.com/${R}/actions/runs/${run}/job/1` });
const pr = (over = {}) => ({
  number: 7,
  state: 'open',
  draft: false,
  labels: [LAND],
  labelTimes: { [LAND]: LABEL_AT },
  forcePushes: [],
  commits: [{ sha: HEAD, parents: [sha('b')], committer: 'someone', verified: false }],
  commitsComplete: true,
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
const REVIEWED = [LAND, NEEDS_REVIEW_LABEL, APPROVE_LABEL];

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
    assert.equal(decide({ labels: [LAND, NEEDS_REVIEW_LABEL], reviews: [verdict(1, 'APPROVE')] }).action, 'WAIT');
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
  test('🔴 a review-CLASSED PR with `land-ok` and NO `needs-review` label → WAIT (the label is a display, not the gate)', () => {
    const files = ['services/platform/src/lib/receipts/apple.ts'];
    const d = decide({ labels: [LAND], files });
    assert.equal(d.action, 'WAIT', d.why);
    assert.match(d.why, /needs-review: no owner verdict yet/);
    assert.equal(reviewRequired({ labels: [LAND], files, filesComplete: true }), 'review-classed: money, api');
    const ok = decide({ labels: [LAND, APPROVE_LABEL], files, reviews: [verdict(1, 'APPROVE')] });
    assert.equal(ok.action, 'MERGE', `an owner APPROVE on the head still lands it: ${ok.why}`);
  });
  test('🔴 an unreadable or capped file list with NO label never merges (SKIP: land by hand), and needs review (fail closed)', () => {
    assert.equal(decide({ labels: [LAND], filesComplete: false }).action, 'SKIP');
    assert.equal(decide({ labels: [LAND], files: null }).action, 'SKIP');
    assert.match(reviewRequired({ labels: [], files: null }), /fail closed/);
    assert.equal(reviewRequired({ labels: [], files: ['tooling/ci/x.mjs'], filesComplete: true }), null);
  });
  test('🔴 any `VERDICT:` line 1 other than exactly `VERDICT: APPROVE` is CHANGES (fail closed)', () => {
    assert.equal(verdictOf('VERDICT: APPROVE'), 'APPROVE');
    assert.equal(verdictOf('VERDICT: APPROVE  '), 'APPROVE');
    for (const l of ['VERDICT: CHANGES', 'VERDICT: CHANGES REQUIRED', 'VERDICT: APPROVE WITH NITS', 'VERDICT: approve', 'VERDICT:']) assert.equal(verdictOf(l), 'CHANGES', l);
    assert.equal(verdictOf('Looks fine.'), null);
    const d = decide({ labels: REVIEWED, reviews: [verdict(1, 'APPROVE'), verdict(2, 'CHANGES REQUIRED')] });
    assert.equal(d.action, 'WAIT', 'a newer CHANGES REQUIRED beats the older APPROVE');
    assert.match(d.why, /is CHANGES \(review 2\)/);
    assert.equal(decide({ labels: REVIEWED, reviews: [verdict(1, 'APPROVE WITH NITS')] }).action, 'WAIT', 'NITS reaching the gate un-mapped is CHANGES');
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
  const fix = (over = {}) => pr({ number: 11, labels: [LAND, FIX_FIRST_LABEL], body: 'Rows: x\nDeploys: none\nFixes-freeze: #50\nLane-runner: fixer', ...over });
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
    assert.equal(plan(snap([fix({ labels: [LAND] })])).act, null);
  });
  test('🔴 a fix that is not green → WAIT; a fix still needs its review when review-classed', () => {
    // Its CI still running: no verdict yet. (A head no run will ever grade gets ci.yml
    // dispatched instead — readying a head, never a merge.)
    assert.equal(plan(snap([fix({ checks: [], runs: [{ id: 100, path: '.github/workflows/ci.yml', status: 'in_progress', conclusion: null, head_sha: HEAD }] })])).act, null);
    assert.notEqual(plan(snap([fix({ checks: [] })])).act?.kind, 'merge');
    assert.equal(plan(snap([fix({ labels: [LAND, FIX_FIRST_LABEL, NEEDS_REVIEW_LABEL] })])).act, null);
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
  test('🔴 a freeze naming a CodeQL job closes on codeql.yml’s run (the watched workflows are UNIONED)', () => {
    const cq = { number: 51, body: '<!-- land-freeze-jobs ["Analyze (javascript)","web"] -->' };
    const ci = check({ web: 'success', other: 'success' });
    const codeql = check({ 'Analyze (javascript)': 'success' }, { runId: 13, url: 'https://x/13' });
    assert.equal(freezeCloseVerdict({ freeze: cq, check: ci }).close, false, 'ci.yml alone cannot see the CodeQL job');
    const u = unionFreezeChecks([ci, codeql]);
    const v = freezeCloseVerdict({ freeze: cq, check: u });
    assert.equal(v.close, true, v.why);
    assert.equal(u.runId, '12+13');
    assert.equal(freezeCloseVerdict({ freeze: cq, check: unionFreezeChecks([ci, check({ 'Analyze (javascript)': 'failure' }, { runId: 13, conclusion: 'failure' })]) }).close, false);
    assert.equal(freezeCloseVerdict({ freeze: cq, check: unionFreezeChecks([ci, check({}, { runId: 13, status: 'in_progress' })]) }).close, false, 'a watched run still going keeps it open');
    assert.equal(freezeCloseVerdict({ freeze: cq, check: unionFreezeChecks([ci, check({ 'Analyze (javascript)': 'success', x: 'failure' }, { runId: 13, conclusion: 'failure', baseline: null })]) }).close, false, 'a part with no baseline keeps its reds new');
    assert.equal(unionFreezeChecks([]), null);
  });
  test('🔴 a union with one part still in_progress is NOT completed (whatever the other part says)', () => {
    const u = unionFreezeChecks([check({ 'Analyze (javascript)': 'success' }, { runId: 13 }), check({}, { runId: 12, status: 'in_progress', conclusion: null })]);
    assert.notEqual(u.status, 'completed');
    assert.equal(u.status, 'in_progress');
    assert.equal(freezeCloseVerdict({ freeze: { number: 51, body: '<!-- land-freeze-jobs ["Analyze (javascript)"] -->' }, check: u }).close, false, 'ci.yml in flight keeps a CodeQL-named freeze open');
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

// readSnapshot's WIRING, over a stubbed `fetch` (review of #1171 round 2, finding 2): the pure
// halves above are held; these hold the reads that feed them.
describe('readSnapshot (stubbed fetch)', () => {
  const MAIN = sha('a');
  const PARENT = sha('b');
  const PR_HEAD = sha('e');
  const DOCS_HEAD = sha('f');
  const run = (id, wf, over = {}) => ({ id, path: `.github/workflows/${wf}`, event: 'push', head_branch: 'main', head_sha: MAIN, status: 'completed', conclusion: 'success', html_url: `https://x/${id}`, created_at: '2026-10-02T08:59:00Z', updated_at: '2026-10-02T08:59:00Z', ...over });
  const routes = (over = {}) => [
    [/^\/commits\/main$/, () => ({ sha: MAIN, parents: [{ sha: PARENT }], commit: { committer: { date: '2026-10-02T08:00:00Z' } } })],
    [new RegExp(`^/actions/workflows/ci\\.yml/runs\\?head_sha=${MAIN}&`), () => ({ workflow_runs: over.mainRuns ?? [run(21, 'ci.yml')] })],
    [new RegExp(`^/actions/workflows/codeql\\.yml/runs\\?head_sha=${MAIN}&`), () => ({ workflow_runs: over.mainRuns ? [] : [run(22, 'codeql.yml')] })],
    [/^\/issues\?labels=land-freeze&state=all&/, () => [{ number: 51, state: 'open', title: 'land-freeze: CodeQL', body: '<!-- land-freeze-jobs ["Analyze (javascript)"] -->' }]],
    [/^\/actions\/runs\/21\/jobs\?/, () => ({ jobs: [{ name: 'web', conclusion: 'success' }] })],
    [/^\/actions\/runs\/22\/jobs\?/, () => ({ jobs: [{ name: 'Analyze (javascript)', conclusion: 'success' }] })],
    [/^\/pulls\?state=open&base=main&/, () => [
      { number: 7, title: 'token crypto', state: 'open', draft: false, labels: [{ name: `${LAND_LABEL}:${PR_HEAD.slice(0, 8)}` }], base: { ref: 'main' }, head: { sha: PR_HEAD, ref: 'feat/x', repo: { full_name: R } } },
      { number: 8, title: 'docs', state: 'open', draft: false, labels: [{ name: `${LAND_LABEL}:${DOCS_HEAD.slice(0, 8)}` }], base: { ref: 'main' }, head: { sha: DOCS_HEAD, ref: 'docs/x', repo: { full_name: R } } },
    ]],
    [/^\/pulls\/[78]$/, () => ({ mergeable: true, mergeable_state: 'clean' })],
    [/^\/issues\/[78]\/events\?/, () => []],
    [/^\/commits\/[0-9a-f]{40}\/check-runs\?/, () => ({ check_runs: [] })],
    [/^\/actions\/workflows\/(ci|e2e)\.yml\/runs\?head_sha=[ef]{40}&/, () => ({ workflow_runs: [] })],
    [/^\/pulls\/[78]\/commits\?/, () => []],
    [/^\/pulls\/7\/files\?/, () => [{ filename: 'services/platform/src/lib/token-crypto.ts' }]],
    [/^\/pulls\/8\/files\?/, () => [{ filename: 'docs/ci/README.md' }]],
    [/^\/compare\//, () => ({ ahead_by: 0, files: [] })],
    [/^\/pulls\/[78]\/reviews\?/, () => [{ id: 9, author_association: 'OWNER', body: 'VERDICT: APPROVE', commit_id: PR_HEAD, submitted_at: '2026-10-02T09:00:00Z', state: 'COMMENTED' }]],
  ];
  const withFetch = async (table, fn) => {
    const asked = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+\/repos\/o\/r/, '');
      asked.push(path);
      const hit = table.find(([re]) => re.test(path));
      const body = hit ? hit[1]() : { message: 'Not Found' };
      return { ok: Boolean(hit), status: hit ? 200 : 404, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) };
    };
    try {
      return await fn(asked);
    } finally {
      globalThis.fetch = real;
    }
  };
  test('🔴 an open freeze naming an `Analyze …` job reads codeql.yml’s run too: freezeCheck holds the CodeQL job', async () => {
    await withFetch(routes(), async (asked) => {
      const snap = await readSnapshot({ repo: R, token: 't', now: new Date('2026-10-02T09:00:00Z') });
      assert.ok(snap.freezeCheck, 'a freeze is open, so the close input was read');
      assert.ok(snap.freezeCheck.jobs.some((j) => j.name === 'Analyze (javascript)'), `freezeCheck.jobs: ${JSON.stringify(snap.freezeCheck.jobs)}`);
      assert.ok(asked.some((p) => p.startsWith('/actions/runs/22/jobs')), 'the codeql.yml run’s jobs were read');
      assert.equal(snap.freezeCheck.status, 'completed');
      assert.equal(freezeCloseVerdict({ freeze: snap.freezes[0], check: snap.freezeCheck }).close, true);
    });
  });
  test('🔴 an UNLABELLED PR whose files are review-classed has its reviews read (the label is not the only input)', async () => {
    await withFetch(routes(), async (asked) => {
      const snap = await readSnapshot({ repo: R, token: 't', now: new Date('2026-10-02T09:00:00Z') });
      const p7 = snap.prs.find((p) => p.number === 7);
      assert.ok(!p7.labels.includes(NEEDS_REVIEW_LABEL), 'the fixture is unlabelled');
      assert.ok(asked.some((p) => p.startsWith('/pulls/7/reviews')), 'its reviews were fetched');
      assert.equal(p7.reviews.length, 1);
      assert.equal(p7.reviews[0].body, 'VERDICT: APPROVE');
      assert.ok(!asked.some((p) => p.startsWith('/pulls/8/reviews')), 'a docs-only PR costs no reviews read');
      assert.deepEqual(snap.prs.find((p) => p.number === 8).reviews, []);
    });
  });
});
