// ─────────────────────────────────────────────────────────────────────────────
// alert-disposition.test.mjs — assert-alert-disposition.mjs must be able to FAIL,
// on BOTH limbs, for the reason it claims.
//
// [pipeline 14]O-5 · [F-10] every guard carries a recorded failing case.
//
// ⚠️ THE LIMB A MUTATIONS RUN AGAINST REAL FILES, NEVER HAND-WRITTEN FIXTURES.
// Every temp tree below is built by COPYING the repository's own e2e.yml,
// ops-watch.yml and tooling/ops/register.json and then breaking one thing in the
// copy. assert-seams-wired.mjs shipped with a check that could not fail while
// all six of its fixture tests passed, because a fixture you write encodes the
// same misunderstanding as the guard you write.
//
// ── THE MUTATION THAT MATTERS, ALSO RUN IN PLACE ON THE REAL TREE ───────────
// 2026-08-07, against the committed tooling/ops/register.json:828 — the clause
// `+ the reused issue titled 'Scheduled duty is not reporting healthy'` was
// deleted from the live file, the guard was run for real against the live GitHub
// API, and it exited 1 with:
//
//     ✗ 1 structural problem(s) — limb A:
//       .github/workflows/ops-watch.yml job 'alert' files the durable issue
//       "Scheduled duty is not reporting healthy" on failure, but NO row in
//       tooling/ops/register.json declares it.
//
// It did NOT narrow two sources to one and report clean over the survivor, which
// is the `check-migrations 5→4` failure this limb exists to prevent. The file was
// then restored from the pre-mutation buffer and `git status --porcelain
// tooling/ops/register.json` returned empty — byte-identical, not merely
// equivalent. M1 below is that same mutation, automated against a copy.
//
// ⚠️ THAT LINE NUMBER WAS 503 AND POINTED AT THE WRONG ROW FOR WEEKS. It was
// CORRECT when written — at 6302a59 the register was 2190 lines and :503 held
// exactly the clause above — and then inserts above it moved the clause to :584
// without moving the citation, so :503 came to name the `duty.workflow.e2e.yml`
// row instead: a different duty, a different issue, and a reader following it
// would have "verified" the wrong thing. This retirement adds 56 more lines
// above it. Re-derived BY CONTENT rather than by arithmetic — the clause was
// searched for, found at :640, and the number set to where it actually is.
//
// 🔴 A LINE NUMBER IS A POINTER INTO A FILE OTHER PEOPLE EDIT, and nothing
// recomputes it. It is correct only until somebody inserts above it, and it
// fails SILENTLY: it still resolves, to a real line, that says something else.
//
// ── LIMB B IS TESTED FOR THE OPPOSITE PROPERTY ─────────────────────────────
// Limb A is tested for its ability to FAIL. Limb B is tested for its refusal to:
// B1 feeds it a real gap (open issue, green source) and asserts the message
// appears AND the exit code is 0. A guard whose owner-gated limb quietly became
// merge-blocking would redden `main` over an act only the owner may perform, so
// "still exits 0 with a gap present" is itself a regression test.
//
// Run:  node --test "tooling/ci/test/alert-disposition.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { reconcile, declaredSources, issueFilingJobs, sourceHealth, classify, parseDispositions, judgeCodeql, scopeToPr, changedEntries, baseEntriesOf, CODEQL_DISPOSITIONS_REL, PINNED_SUPABASE_HOST, firingHistoryUrl } from '../assert-alert-disposition.mjs';
import { runQueryPredicate } from '../run-page-anchor.mjs';
import { SUPABASE_HOSTED_HOST_SHA256 } from '../../ops/credential-origin.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-alert-disposition.mjs');
const REGISTER = 'tooling/ops/register.json';
const E2E = '.github/workflows/e2e.yml';
const OPSWATCH = '.github/workflows/ops-watch.yml';
const NOW = '2026-08-07T12:00:00Z';
const NOW_MS = Date.parse(NOW);

const E2E_TITLE = 'Nightly E2E (live) is failing against production';
const OPS_TITLE = 'Scheduled duty is not reporting healthy';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-o5-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
/** A real tree: the repository's OWN workflows and register, copied. */
function tree() {
  const root = join(TMP, `t${seq++}`);
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  mkdirSync(join(root, 'tooling/ops'), { recursive: true });
  cpSync(join(REPO, E2E), join(root, E2E));
  cpSync(join(REPO, OPSWATCH), join(root, OPSWATCH));
  cpSync(join(REPO, REGISTER), join(root, REGISTER));
  return root;
}
const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
const write = (root, rel, text) => writeFileSync(join(root, rel), text);
const joined = (root) => reconcile(root).problems.join('\n');

// A catch must be THIS guard's assertion, never a crash. A SyntaxError or a
// thrown TypeError would produce no problem string at all, so asserting on the
// message text is what distinguishes a caught mutation from a broken guard —
// three "caught" results in this repo on 2026-07-26 turned out to be compile
// errors wearing a catch's clothes.
function caught(root, needle) {
  const text = joined(root);
  assert.ok(text.includes(needle), `expected a problem containing ${JSON.stringify(needle)}, got:\n${text || '(none — the guard reported CLEAN)'}`);
}

describe('[14]O-5 · baseline — the real tree is structurally clean', () => {
  test('the committed tree yields exactly two declared alerting sources', () => {
    const { problems, sources } = reconcile(REPO);
    assert.deepEqual(problems, []);
    assert.equal(sources.length, 2);
    assert.deepEqual(
      sources.map((s) => s.id).sort(),
      ['duty.workflow.e2e.yml', 'duty.workflow.ops-watch.yml'],
    );
  });

  test('the markers are DERIVED from the register, not typed into the guard', () => {
    // If a title were hard-coded, changing the register would not change this.
    // ⚠️ Target the DECLARATION clause, not the first occurrence of the string:
    // the title also appears twice in prose (`evidence` at :360, `drillGapClosed`
    // at :363), and a bare .replace() would have rewritten one of those and left
    // the declaration untouched — a mutation that mutates nothing under test.
    const root = tree();
    write(root, REGISTER, read(root, REGISTER).replace(`the reused issue titled '${OPS_TITLE}'`, "the reused issue titled 'A completely different marker'"));
    const declared = declaredSources(root).map((d) => d.title);
    assert.ok(declared.includes('A completely different marker'));
    assert.ok(!declared.includes(OPS_TITLE));
  });

  test('the digest job is classified as a NON-alert by its condition, not by name', () => {
    const jobs = issueFilingJobs(REPO);
    const digest = jobs.find((j) => j.job === 'digest');
    assert.ok(digest, 'ops-watch.yml digest job files an issue and must be seen');
    assert.equal(digest.alerting, false);
    assert.ok(jobs.filter((j) => j.alerting).length === 2);
  });
});

describe('[14]O-5 · LIMB A — structural, fails the build', () => {
  // M1 — THE MUTATION THE HEADER RECORDS, automated. Deleting the declaration
  // clause must NOT silently narrow the source set from 2 to 1.
  test('M1 a register row loses its `the reused issue titled` clause', () => {
    const root = tree();
    write(root, REGISTER, read(root, REGISTER).replace(` + the reused issue titled '${OPS_TITLE}'`, ''));
    assert.equal(declaredSources(root).length, 1, 'the declared set really did narrow');
    caught(root, `files the durable issue "${OPS_TITLE}" on failure, but NO row in`);
  });

  test('M2 a register row declares a title no job files any more', () => {
    const root = tree();
    write(root, OPSWATCH, read(root, OPSWATCH).replace(`TITLE: '${OPS_TITLE}'`, "TITLE: 'Some other thread'"));
    caught(root, 'but no `failure()`-gated job in .github/workflows files it');
  });

  test('M3 the alert job stops being gated on failure()', () => {
    const root = tree();
    // ⏱ 2026-10-01 (PB-02): the alert job's `if:` gained the platform Worker's unattended
    // dispatch, so the literal this case replaced was gone and the mutation changed
    // NOTHING — the guard reported clean on an unmutated file. It now asserts the edit landed.
    const before = read(root, OPSWATCH);
    const after = before.replace('if: failure() && (', 'if: (');
    assert.notEqual(after, before, 'the mutation found no `if: failure() && (` to replace, so this case would test nothing');
    write(root, OPSWATCH, after);
    caught(root, 'it is not gated on failure() — it is a digest, not an alarm');
  });

  test('M4 the TITLE stops being a literal', () => {
    const root = tree();
    write(root, E2E, read(root, E2E).replace(`TITLE: '${E2E_TITLE}'`, 'TITLE: ${{ env.SOMETHING }}'));
    caught(root, "calls `gh issue create` but declares no literal `TITLE:`");
  });

  test('M5 the anchor and the filing workflow are crossed', () => {
    const root = tree();
    write(root, REGISTER, read(root, REGISTER).replace('"anchor": ".github/workflows/ops-watch.yml"', '"anchor": ".github/workflows/e2e.yml"'));
    caught(root, 'while the job that actually files it is');
  });

  test('M6 nothing in the tree files an issue any more — the MATCHER loses its domain', () => {
    const root = tree();
    for (const wf of [E2E, OPSWATCH]) write(root, wf, read(root, wf).replaceAll('gh issue create', 'gh issue draft'));
    caught(root, 'COVERAGE LOST — no job in .github/workflows matches');
  });

  test('M7 the register declares no durable issue at all', () => {
    const root = tree();
    write(root, REGISTER, read(root, REGISTER).replaceAll('the reused issue titled', 'the reused issue called'));
    caught(root, 'COVERAGE LOST — no row in tooling/ops/register.json declares a durable issue');
  });

  test('M8 the register is gone', () => {
    const root = tree();
    rmSync(join(root, REGISTER));
    caught(root, 'COVERAGE LOST — tooling/ops/register.json does not exist');
  });

  test('M9 the register is unparseable — NOT the same as empty', () => {
    const root = tree();
    write(root, REGISTER, '{ "rows": [ ');
    caught(root, 'could not be parsed');
    assert.ok(!joined(root).includes('declares no durable issue'), 'an unreadable register must not be reported as an empty one');
  });

  test('M10 the workflow directory is gone', () => {
    const root = tree();
    rmSync(join(root, '.github/workflows'), { recursive: true });
    caught(root, 'COVERAGE LOST — .github/workflows does not exist');
  });
});

describe('[14]O-5 · LIMB A — the firing history must be READABLE (fail-closed)', () => {
  const runGuard = (probe, env = {}) => {
    const file = join(TMP, `probe${seq++}.json`);
    if (probe !== null) writeFileSync(file, JSON.stringify(probe));
    const args = probe === null ? [GUARD] : [GUARD, '--probe-file', file, '--now', NOW];
    const base = { ...process.env };
    delete base.GITHUB_TOKEN;
    delete base.GH_TOKEN;
    return spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...base, ...env } });
  };

  // 🔴 EVERY ASSERTION IN THIS BLOCK IS `status === 2`, NOT MERELY `!== 0`.
  //    Until 2026-09-09 they all asserted 1, and 1 is this guard's code for an
  //    ANSWERED negative — so a GitHub 403 rate limit (the history was not read)
  //    was indistinguishable from a broken declaration (the history was read and
  //    is wrong). That is what turned a transient outage into a deploy refusal.
  //    `assert.equal(r.status, 2)` fails on BOTH 0 and 1, so it pins the code in
  //    both directions: restoring `process.exit(1)` at any of these call sites
  //    reddens this block, and so does any future attempt to waive them to 0.
  const unread = (r, why) => {
    assert.equal(r.status, 2, `unreadable must exit 2 (COVERAGE LOST), not ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.notEqual(r.status, 1, 'exit 1 is this guard\'s ANSWERED negative and must not be reused for silence');
    assert.match(r.stderr, /COVERAGE LOST \(exit 2\)/);
    assert.match(r.stderr, why);
  };

  test('M11 no token at all — "I could not look" must never read as "it is fine"', () => {
    const r = runGuard(null);
    unread(r, /neither GITHUB_TOKEN nor GH_TOKEN is in the environment/);
    assert.doesNotMatch(r.stderr, /SyntaxError|ReferenceError|TypeError/);
  });

  test('M12 the issue enumeration itself fails', () => {
    const r = runGuard({ issuesError: 'GitHub API returned 403 for /repos/x/issues' });
    unread(r, /the firing history is NOT readable/);
  });

  test('M12b a 403 rate limit is COVERAGE LOST, never a finding about the alerting', () => {
    const r = runGuard({ issuesError: 'GitHub API returned 403 for /repos/x/issues — API rate limit exceeded for installation' });
    unread(r, /rate limit exceeded for installation/);
    // The wording a human reads off a red step must say the question went
    // unanswered. Without this the code changes and the message still accuses.
    assert.match(r.stderr, /went\s+unanswered on this runner/);
    // ⚠️ NOT `✓ limb A`: that line is the DECLARATION limb, which legitimately
    //    passed before the history was ever fetched. The line that must be
    //    absent is the disposition verdict — the only one that would be a claim
    //    about firings the guard never enumerated.
    assert.doesNotMatch(r.stdout, /limb B/);
  });

  test('M13 a declared source has no scheduled run history — unreadable, not healthy', () => {
    const r = runGuard({
      issues: [],
      runs: { 'e2e.yml': [{ id: 1, event: 'workflow_dispatch', conclusion: 'success', created_at: NOW }], 'ops-watch.yml': [{ id: 2, event: 'schedule', conclusion: 'success', created_at: NOW }] },
    });
    unread(r, /could not be read: no scheduled run in the sampled history/);
  });

  test('M14 the open-issue enumeration returns a non-list', () => {
    const r = runGuard({ issues: { not: 'a list' }, runs: {} });
    unread(r, /did not return a list/);
  });

  // 🔴 THE OTHER HALF OF THE SPLIT, ASSERTED SO THE TWO CODES CANNOT COLLAPSE
  //    BACK INTO ONE. A structural problem in the repository's own content is an
  //    ANSWERED negative and keeps exit 1. If a later change re-points the whole
  //    file at 2 for tidiness, exit 2 stops meaning "unreadable" and the tests
  //    above become vacuous — this test is what stops that being silent.
  test('M15 an ANSWERED negative keeps exit 1 — the two codes stay distinct', () => {
    // ⚠️ THE GUARD IS COPIED INTO THE TREE, not merely run with `cwd` set. It
    //    resolves its ROOT from `import.meta.url`, so spawning the REPOSITORY's
    //    copy from a temp directory scans the repository — a test written that
    //    way passes on the live tree's health and proves nothing. Three files
    //    are the whole dependency closure: the guard, workflow-scan, tree-walk.
    const root = tree();
    mkdirSync(join(root, 'tooling/ci'), { recursive: true });
    // ⏱ 2026-09-26: workflow-scan now imports the composer and app-set, and the
    // composer imports ../app-yaml/yaml.mjs (O-FLUTTER-BUILD-TYPED-PER-LINE).
    for (const f of ['assert-alert-disposition.mjs', 'workflow-scan.mjs', 'tree-walk.mjs', 'flutter-release-build.mjs', 'app-set.mjs']) {
      cpSync(join(CI_DIR, f), join(root, 'tooling/ci', f));
    }
    mkdirSync(join(root, 'tooling/app-yaml'), { recursive: true });
    cpSync(join(CI_DIR, '..', 'app-yaml', 'yaml.mjs'), join(root, 'tooling/app-yaml', 'yaml.mjs'));
    // ⏱ 2026-09-28: the run history reads through the shared anchored reader.
    for (const f of ['anchored-run-read.mjs', 'run-page-anchor.mjs']) cpSync(join(CI_DIR, f), join(root, 'tooling/ci', f));
    mkdirSync(join(root, 'tooling/ops'), { recursive: true });
    cpSync(join(CI_DIR, '..', 'ops', 'bounded-retry.mjs'), join(root, 'tooling/ops', 'bounded-retry.mjs'));
    // ⏱ 2026-09-30: limb C reads the alerts through the ops reader.
    cpSync(join(CI_DIR, '..', 'ops', 'check-code-scanning-age.mjs'), join(root, 'tooling/ops', 'check-code-scanning-age.mjs'));
    cpSync(join(CI_DIR, '..', 'ops', 'credential-origin.mjs'), join(root, 'tooling/ops', 'credential-origin.mjs'));
    // ⏱ 2026-10-03 · port-codehost: the default repository is the rendered code-host module's.
    mkdirSync(join(root, 'tooling/generated'), { recursive: true });
    cpSync(join(CI_DIR, '..', 'generated', 'codehost.mjs'), join(root, 'tooling/generated', 'codehost.mjs'));
    rmSync(join(root, '.github/workflows'), { recursive: true });
    const r = spawnSync(process.execPath, [join(root, 'tooling/ci/assert-alert-disposition.mjs')], { cwd: root, encoding: 'utf8' });
    assert.match(r.stderr, /COVERAGE LOST — \.github\/workflows does not exist/);
    assert.equal(r.status, 1, `a structural verdict is an ANSWERED negative, not silence:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /COVERAGE LOST \(exit 2\)/);
  });
});

describe('[14]O-5 · LIMB B — prints the gap, and must NOT fail the build', () => {
  const scheduled = (id, conclusion) => ({ id, event: 'schedule', conclusion, created_at: '2026-08-07T06:00:00Z' });
  const issue = (number, title, created_at) => ({ number, title, created_at, state: 'open' });
  // ⏱ 2026-09-30: limb C runs after limb B and refuses a probe with no `codeql`
  // answer, so these limb B probes carry one. ⏱ 2026-10-01: an all-empty read is
  // COVERAGE LOST now (review of #1097, finding 4), so it holds one fixed alert.
  const runGuard = (probe) => {
    const file = join(TMP, `probe${seq++}.json`);
    writeFileSync(file, JSON.stringify({ codeql: { open: [], dismissed: [], fixed: [{ number: 1, state: 'fixed' }] }, ...probe }));
    return spawnSync(process.execPath, [GUARD, '--probe-file', file, '--now', NOW], { cwd: REPO, encoding: 'utf8' });
  };

  test('B1 open issue + GREEN source = an undispositioned firing, PRINTED, exit 0', () => {
    const r = runGuard({
      issues: [issue(24, E2E_TITLE, '2026-07-27T06:47:16Z')],
      runs: { 'e2e.yml': [scheduled(31149441398, 'success')], 'ops-watch.yml': [scheduled(31162205780, 'failure')] },
    });
    assert.equal(r.status, 0, `limb B must never fail the build:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /1 UNDISPOSITIONED FIRING/);
    assert.match(r.stdout, /⬜ #24 "Nightly E2E \(live\) is failing against production" — open 11\.2 day\(s\)/);
    assert.match(r.stdout, /do not "fix" it into a failure/);
  });

  test('B2 open issue + RED source is NOT a gap — a live alarm is not an ignored one', () => {
    const r = runGuard({
      issues: [issue(151, OPS_TITLE, '2026-08-04T10:08:00Z')],
      runs: { 'e2e.yml': [scheduled(1, 'success')], 'ops-watch.yml': [scheduled(31162205780, 'failure')] },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /#151 is open and its source is RED right now/);
    assert.doesNotMatch(r.stdout, /UNDISPOSITIONED/);
  });

  test('B3 the real state today — #24 flagged, #151 not, in ONE run', () => {
    const r = runGuard({
      issues: [issue(24, E2E_TITLE, '2026-07-27T06:47:16Z'), issue(151, OPS_TITLE, '2026-08-04T10:08:00Z'), issue(140, 'Weekly ops digest', '2026-08-03T10:57:54Z')],
      runs: { 'e2e.yml': [scheduled(31149441398, 'success')], 'ops-watch.yml': [scheduled(31162205780, 'failure')] },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /1 UNDISPOSITIONED FIRING/);
    assert.match(r.stdout, /⬜ #24 /);
    assert.doesNotMatch(r.stdout, /⬜ #151 /);
    // #140 is filed by a timer job, is declared by no row, and must never be scored.
    assert.doesNotMatch(r.stdout, /⬜ #140 /);
  });

  test('B4 no open issue against a green source = every firing dispositioned', () => {
    const r = runGuard({ issues: [], runs: { 'e2e.yml': [scheduled(1, 'success')], 'ops-watch.yml': [scheduled(2, 'success')] } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Every firing has been dispositioned/);
    assert.doesNotMatch(r.stdout, /UNDISPOSITIONED/);
  });

  test('B5 an indeterminate source claims NEITHER state', () => {
    const r = runGuard({
      issues: [issue(24, E2E_TITLE, '2026-07-27T06:47:16Z')],
      runs: { 'e2e.yml': [{ id: 9, event: 'schedule', conclusion: 'cancelled', created_at: NOW }], 'ops-watch.yml': [scheduled(2, 'success')] },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /neither success nor failure/);
    assert.doesNotMatch(r.stdout, /UNDISPOSITIONED/);
  });
});

describe('[14]O-5 · the verdict functions, in isolation', () => {
  const s = (event, conclusion, created_at) => ({ id: 1, event, conclusion, created_at });

  test('sourceHealth counts ONLY scheduled runs', () => {
    // A hand-pressed green says nothing about an alarm gated on `schedule`.
    assert.equal(sourceHealth([s('workflow_dispatch', 'success', NOW), s('schedule', 'failure', NOW)]).state, 'red');
  });

  test('sourceHealth takes the NEWEST scheduled run, not the first in the list', () => {
    const h = sourceHealth([s('schedule', 'failure', '2026-08-01T00:00:00Z'), s('schedule', 'success', '2026-08-07T00:00:00Z')]);
    assert.equal(h.state, 'green');
    assert.equal(h.firings, 1);
  });

  test('sourceHealth fails to `unreadable`, never to a pass', () => {
    assert.equal(sourceHealth(null).state, 'unreadable');
    assert.equal(sourceHealth([]).state, 'unreadable');
    assert.equal(sourceHealth([s('schedule', null, NOW)]).state, 'indeterminate');
  });

  test('classify: green ⇒ undispositioned, red ⇒ active, and the age is real', () => {
    const i = { number: 24, title: E2E_TITLE, created_at: '2026-07-27T06:47:16Z' };
    assert.equal(classify(i, { state: 'green' }, NOW_MS).verdict, 'undispositioned');
    assert.equal(classify(i, { state: 'red' }, NOW_MS).verdict, 'active');
    assert.equal(classify(i, { state: 'indeterminate' }, NOW_MS).verdict, 'indeterminate');
    assert.ok(Math.abs(classify(i, { state: 'green' }, NOW_MS).ageDays - 11.2) < 0.1);
  });

  test('NO comment-count heuristic exists to be fooled', () => {
    // #24 carries seven comments, every one github-actions[bot]; all seventeen
    // GlitchTip issues carry zero. If the verdict read comments at all, adding
    // them here would move it. It does not.
    const i = { number: 24, title: E2E_TITLE, created_at: '2026-07-27T06:47:16Z', comments: 7 };
    const bare = { number: 24, title: E2E_TITLE, created_at: '2026-07-27T06:47:16Z', comments: 0 };
    assert.equal(classify(i, { state: 'green' }, NOW_MS).verdict, classify(bare, { state: 'green' }, NOW_MS).verdict);
    assert.ok(!readFileSync(GUARD, 'utf8').match(/\.comments\b(?!\s*—)/), 'the guard must not read a comment count');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMB C — CodeQL is a declared source (2026-09-30). The RED controls are the
// point: an undispositioned open alert FAILS, a disposition that names a
// different alert FAILS, a fixed-in-tree claim main's analysis already
// disproved FAILS, an unreadable alert list is COVERAGE LOST — and a stale
// entry PRINTS and does not fail, for the reason in the guard's limb C header.
// The spawned cases run the REAL guard against the REAL dispositions file.
// ─────────────────────────────────────────────────────────────────────────────
describe('LIMB C — every open CodeQL alert is fixed in code or carries a disposition', () => {
  const REAL = parseDispositions(readFileSync(join(REPO, CODEQL_DISPOSITIONS_REL), 'utf8'));
  const green = { issues: [], runs: { 'e2e.yml': [{ id: 1, event: 'schedule', conclusion: 'success', created_at: NOW }], 'ops-watch.yml': [{ id: 2, event: 'schedule', conclusion: 'success', created_at: NOW }] } };
  const SHA = 'a'.repeat(40);
  const alert = (number, rule, path, extra = {}) => ({
    number,
    state: 'open',
    created_at: '2026-09-01T00:00:00Z',
    rule: { id: rule, severity: 'error', security_severity_level: 'high' },
    most_recent_instance: { commit_sha: SHA, location: { path, start_line: 1 } },
    ...extra,
  });
  const fromEntry = (e, extra) => alert(e.alert, e.rule, e.path, extra);
  const runGuard = (probe) => {
    const file = join(TMP, `probe${seq++}.json`);
    writeFileSync(file, JSON.stringify({ ...green, ...probe }));
    return spawnSync(process.execPath, [GUARD, '--probe-file', file, '--now', NOW], { cwd: REPO, encoding: 'utf8' });
  };

  test('the committed dispositions file parses clean and is not empty', () => {
    assert.deepEqual(REAL.problems, []);
    assert.ok(REAL.entries.length > 0, 'an empty file would make every spawned case below vacuous');
  });

  test('GREEN control: every open alert matches an entry → exit 0', () => {
    const r = runGuard({ codeql: { open: REAL.entries.map((e) => fromEntry(e)), dismissed: [] } });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /✓ limb C — every open code-scanning alert is fixed in code or carries a disposition/);
  });

  test('RED C1: one undispositioned open alert fails the build (exit 1) and is named', () => {
    const r = runGuard({ codeql: { open: [...REAL.entries.map((e) => fromEntry(e)), alert(999999, 'js/bad-tag-filter', 'tooling/ci/x.mjs')], dismissed: [] } });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /✗ limb C — 1 code-scanning alert\(s\) with NO disposition/);
    assert.match(r.stderr, /#999999 {2}js\/bad-tag-filter/);
  });

  test('RED C2: a dismissed alert with NO reason and no entry is graded like an open one', () => {
    const r = runGuard({ codeql: { open: [], dismissed: [alert(999998, 'js/log-injection', 'a.mjs', { state: 'dismissed', dismissed_reason: null })] } });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /#999998 .*\(dismissed WITHOUT a reason\)/);
  });

  test('a dismissed alert WITH a reason needs no entry', () => {
    const r = runGuard({ codeql: { open: [], dismissed: [alert(999997, 'js/log-injection', 'a.mjs', { state: 'dismissed', dismissed_reason: 'false positive' })] } });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });

  test('RED C3: an entry whose alert number now names a different path fails (exit 1)', () => {
    const [first, ...rest] = REAL.entries;
    const r = runGuard({ codeql: { open: [alert(first.alert, first.rule, `${first.path}.moved`), ...rest.map((e) => fromEntry(e))], dismissed: [] } });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`entry #${first.alert} says .* It dispositions a different alert`));
  });

  test('STALE: an entry naming a closed alert is REPORTED, and does not fail (exit 0)', () => {
    const r = runGuard({ codeql: { open: [], dismissed: [], fixed: REAL.entries.map((e) => fromEntry(e, { state: 'fixed' })) } });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const stale = r.stdout.match(/⬜ STALE — #\d+/g) ?? [];
    assert.equal(stale.length, REAL.entries.length, 'every entry names an alert that is neither open nor dismissed here');
  });

  // ⏱ 2026-10-01 (review 2, finding 4): main's FIXED list decides STALE. An entry
  // main has never read is a PR's own new alert, and deleting it reddens main.
  test('NOT ON MAIN YET: an entry whose alert main never read is KEPT, never labelled STALE', () => {
    const [first, second] = REAL.entries;
    const r = runGuard({ codeql: { open: [], dismissed: [], fixed: [fromEntry(first, { state: 'fixed' })] } });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, new RegExp(`⬜ STALE — #${first.alert} .* is FIXED on main\\. Delete its entry`));
    assert.match(r.stdout, new RegExp(`⬜ NOT ON MAIN YET — #${second.alert} .* KEEP the entry`));
    assert.doesNotMatch(r.stdout, new RegExp(`STALE — #${second.alert} `));
    assert.equal((r.stdout.match(/⬜ STALE — #\d+/g) ?? []).length, 1);
  });

  // ⏱ 2026-10-01 (review 2, finding 2): the PR analysis is diff-informed, so an
  // alert on an unchanged line first opens on MAIN. On a pull request it is main
  // debt unless the PR changes its path; main's own run still fails on it.
  test('PULL REQUEST: an undispositioned alert in a path the PR does not change is MAIN DEBT → exit 0', () => {
    const extra = alert(999995, 'js/unused-local-variable', 'tooling/ci/untouched.mjs');
    const r = runGuard({ prTouched: ['tooling/ci/other.mjs'], codeql: { open: [...REAL.entries.map((e) => fromEntry(e)), extra], dismissed: [] } });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /⬜ MAIN DEBT — #999995 js\/unused-local-variable tooling\/ci\/untouched\.mjs:1 has NO disposition, in a path this pull request does not change/);
    assert.match(r.stdout, /✓ limb C — every alert in a path this pull request changes carries a disposition; 1 main-debt alert\(s\)/);
  });

  test('RED PULL REQUEST: the same alert in a path the PR DOES change fails (exit 1)', () => {
    const extra = alert(999995, 'js/unused-local-variable', 'tooling/ci/untouched.mjs');
    const r = runGuard({ prTouched: ['tooling/ci/untouched.mjs'], codeql: { open: [...REAL.entries.map((e) => fromEntry(e)), extra], dismissed: [] } });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /#999995 {2}js\/unused-local-variable/);
    assert.doesNotMatch(r.stdout, /MAIN DEBT/);
  });

  // ⏱ 2026-10-01 (review of #1097, finding 1, MAJOR): a PR's own change to a LIVE
  // disposition is the PR's, wherever the alert's file is. Before, each of these
  // printed MAIN DEBT and passed, and main went red on the merge.
  const live = () => REAL.entries.map((e) => fromEntry(e));
  const withFile = (entries, probe) => {
    // The guard reads the dispositions file from ITS tree, so these run the real
    // guard in a copy whose file is the PR's edited version.
    const root = tree();
    mkdirSync(join(root, 'tooling/ci'), { recursive: true });
    for (const f of ['assert-alert-disposition.mjs', 'workflow-scan.mjs', 'tree-walk.mjs', 'flutter-release-build.mjs', 'app-set.mjs', 'anchored-run-read.mjs', 'run-page-anchor.mjs']) {
      cpSync(join(CI_DIR, f), join(root, 'tooling/ci', f));
    }
    mkdirSync(join(root, 'tooling/app-yaml'), { recursive: true });
    cpSync(join(CI_DIR, '..', 'app-yaml', 'yaml.mjs'), join(root, 'tooling/app-yaml', 'yaml.mjs'));
    for (const f of ['bounded-retry.mjs', 'check-code-scanning-age.mjs', 'credential-origin.mjs']) cpSync(join(CI_DIR, '..', 'ops', f), join(root, 'tooling/ops', f));
    mkdirSync(join(root, 'tooling/generated'), { recursive: true });
    cpSync(join(CI_DIR, '..', 'generated', 'codehost.mjs'), join(root, 'tooling/generated', 'codehost.mjs'));
    write(root, CODEQL_DISPOSITIONS_REL, JSON.stringify({ dispositions: entries }));
    const file = join(TMP, `probe${seq++}.json`);
    writeFileSync(file, JSON.stringify(probe));
    return spawnSync(process.execPath, [join(root, 'tooling/ci/assert-alert-disposition.mjs'), '--limb', 'C', '--probe-file', file], { cwd: root, encoding: 'utf8' });
  };
  const DISP = [CODEQL_DISPOSITIONS_REL];

  test('🔴 PULL REQUEST: deleting a LIVE entry fails the PR (exit 1), even with the base file given', () => {
    const [gone, ...kept] = REAL.entries;
    const r = withFile(kept, { prTouched: DISP, prBaseDispositions: REAL.entries, codeql: { open: live(), dismissed: [] } });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`#${gone.alert} {2}`));
    assert.doesNotMatch(r.stdout, /MAIN DEBT/);
  });

  test('🔴 PULL REQUEST: deleting a LIVE entry with NO readable base fails too (strict)', () => {
    const [, ...kept] = REAL.entries;
    const r = withFile(kept, { prTouched: DISP, codeql: { open: live(), dismissed: [] } });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /STRICTLY \(it changes the dispositions file and its base could not be read\)/);
  });

  test('🔴 PULL REQUEST: editing a LIVE entry so it no longer matches its alert fails (exit 1)', () => {
    const [first, ...rest] = REAL.entries;
    const edited = [{ ...first, path: `${first.path}.moved`, reason: `${first.reason} (edited)` }, ...rest];
    const r = withFile(edited, { prTouched: DISP, prBaseDispositions: REAL.entries, codeql: { open: live(), dismissed: [] } });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`entry #${first.alert} says .* It dispositions a different alert`));
  });

  test('PULL REQUEST GREEN CONTROL: an untouched undispositioned alert elsewhere is MAIN DEBT (exit 0) while the PR edits another entry', () => {
    const [first, ...rest] = REAL.entries;
    const edited = [{ ...first, reason: `${first.reason} (reworded)` }, ...rest];
    const extra = alert(999993, 'js/unused-local-variable', 'tooling/ci/untouched.mjs');
    const r = withFile(edited, { prTouched: DISP, prBaseDispositions: REAL.entries, codeql: { open: [...live(), extra], dismissed: [] } });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /⬜ MAIN DEBT — #999993 /);
    assert.match(r.stdout, /on the 1 entr\(ies\) it adds, removes or edits/);
  });

  // ⏱ 2026-10-01: CI on this PR printed "its base could not be read" — main's file
  // still held `*.supabase.co`, which the head refuses, and the base was VALIDATED.
  test('a base file written under an older rule (a wildcard host) is still read for the diff', () => {
    const legacy = REAL.entries.map((e) => (e.host ? { ...e, host: ['*.supabase.co'] } : e));
    assert.ok(parseDispositions(JSON.stringify({ dispositions: legacy })).problems.length > 0, 'the legacy file must fail validation, or this case proves nothing');
    assert.equal(baseEntriesOf(JSON.stringify({ dispositions: legacy })).length, REAL.entries.length);
    assert.equal(baseEntriesOf('not json'), null);
    const extra = alert(999992, 'js/unused-local-variable', 'tooling/ci/untouched.mjs');
    const r = withFile(REAL.entries, { prTouched: DISP, prBaseDispositions: legacy, codeql: { open: [...live(), extra], dismissed: [] } });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /STRICTLY/);
    assert.match(r.stdout, /⬜ MAIN DEBT — #999992 /);
  });

  test('changedEntries: added, removed and edited numbers; an identical entry with keys reordered is not a change', () => {
    const a = { alert: 1, rule: 'r', path: 'p', disposition: 'by-design', reason: 'x' };
    const b = { alert: 2, rule: 'r', path: 'p', disposition: 'by-design', reason: 'x' };
    const reordered = { reason: 'x', disposition: 'by-design', path: 'p', rule: 'r', alert: 1 };
    assert.deepEqual([...changedEntries([a, b], [reordered, { ...b, reason: 'y' }, { ...b, alert: 3 }])].sort(), [2, 3]);
    assert.deepEqual([...changedEntries([a, b], [a])], [2]);
  });

  // ⏱ 2026-10-01 (review of #1097, finding 4): an empty read graded nothing and said ✓.
  test('🔴 COVERAGE LOST: an all-empty alert read (open, dismissed, fixed) is exit 2, never a pass', () => {
    const r = runGuard({ codeql: { open: [], dismissed: [], fixed: [] } });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /EMPTY READ: the API returned no alert in any state/);
  });

  test('🔴 COVERAGE LOST: --analysis-of a commit with no listed analysis is exit 2, and an empty read beside a real analysis says so', () => {
    const SHA_A = 'b'.repeat(40);
    const file = join(TMP, `probe${seq++}.json`);
    const spawnC = (codeql) => {
      writeFileSync(file, JSON.stringify({ codeql }));
      return spawnSync(process.execPath, [GUARD, '--limb', 'C', '--analysis-of', SHA_A, '--probe-file', file], { cwd: REPO, encoding: 'utf8' });
    };
    const none = spawnC({ open: live(), dismissed: [], analyses: [{ id: 7, commit_sha: 'c'.repeat(40), results_count: 63 }] });
    assert.equal(none.status, 2, `${none.stdout}${none.stderr}`);
    assert.match(none.stderr, /NO ANALYSIS FOUND: no CodeQL analysis of bbbbbbbbbbbb is listed/);
    const empty = spawnC({ open: [], dismissed: [], fixed: [], analyses: [{ id: 8, commit_sha: SHA_A, results_count: 63 }] });
    assert.equal(empty.status, 2, `${empty.stdout}${empty.stderr}`);
    assert.match(empty.stderr, /ZERO ALERTS WHILE THE ANALYSIS EXISTS: analysis 8 of bbbbbbbbbbbb \(results 63\)/);
    const green = spawnC({ open: live(), dismissed: [], analyses: [{ id: 9, commit_sha: SHA_A, results_count: 63 }] });
    assert.equal(green.status, 0, `GREEN control:\n${green.stdout}${green.stderr}`);
    assert.match(green.stdout, /graded after analysis 9 of bbbbbbbbbbbb/);
  });

  test('scopeToPr: with no pull request (touched null) nothing is moved to debt', () => {
    const v = judgeCodeql({ open: [alert(5, 'js/x', 'a.mjs')], dismissed: [], entries: [] });
    const scoped = scopeToPr(v, null);
    assert.equal(scoped.failed, true);
    assert.deepEqual(scoped.debt, []);
    assert.equal(scopeToPr(v, new Set(['b.mjs'])).failed, false);
  });

  test('--limb C runs limb C alone (the last step of the codeql.yml analyze job): red and green, and no other limb is accepted', () => {
    const file = join(TMP, `probe${seq++}.json`);
    const spawnC = (codeql, limb = 'C') => {
      writeFileSync(file, JSON.stringify({ codeql }));
      return spawnSync(process.execPath, [GUARD, '--limb', limb, '--probe-file', file], { cwd: REPO, encoding: 'utf8' });
    };
    const green = spawnC({ open: REAL.entries.map((e) => fromEntry(e)), dismissed: [] });
    assert.equal(green.status, 0, `${green.stdout}${green.stderr}`);
    assert.doesNotMatch(green.stdout, /limb A/);
    const red = spawnC({ open: [alert(999994, 'js/x', 'a.mjs')], dismissed: [] });
    assert.equal(red.status, 1, `${red.stdout}${red.stderr}`);
    assert.match(red.stderr, /#999994 {2}js\/x/);
    assert.equal(spawnC({ open: [], dismissed: [] }, 'A').status, 1);
  });

  test('COVERAGE LOST: the alert read failed → exit 2, never a pass', () => {
    const r = runGuard({ codeqlError: 'GET .../code-scanning/alerts answered HTTP 403 (the token needs security-events: read)' });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST \(exit 2\)[\s\S]*security-events: read/);
  });

  test('COVERAGE LOST: a probe with no codeql answer → exit 2', () => {
    const r = runGuard({});
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no `codeql` answer/);
  });

  test('COVERAGE LOST: an alert with no location path → exit 2', () => {
    const r = runGuard({ codeql: { open: [{ ...alert(999996, 'js/x', 'a'), most_recent_instance: {} }], dismissed: [] } });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no most_recent_instance\.location\.path/);
  });

  test('judgeCodeql: a fixed-in-tree claim the analysed commit already carried is DISPROVED', () => {
    const entries = [{ alert: 7, rule: 'js/x', path: 'a.mjs', disposition: 'fixed-in-tree', reason: 'fixed' }];
    const open = [alert(7, 'js/x', 'a.mjs')];
    const disproved = judgeCodeql({ open, dismissed: [], entries, claimAt: (sha, n) => sha === SHA && n === 7 });
    assert.equal(disproved.failed, true);
    assert.equal(disproved.disproved.length, 1);
    const pending = judgeCodeql({ open, dismissed: [], entries, claimAt: () => false });
    assert.equal(pending.failed, false);
    assert.equal(pending.pending.length, 1);
    const unreadableCommit = judgeCodeql({ open, dismissed: [], entries, claimAt: () => null });
    assert.equal(unreadableCommit.failed, false, 'a commit this clone cannot read is pending, never disproved');
  });

  test('RED C4 (spawned, in a copied tree): a disproved fixed-in-tree claim fails the build', () => {
    // The guard resolves ROOT from import.meta.url, so it is COPIED into a tree
    // whose dispositions file carries a fixed-in-tree claim (the M15 pattern).
    const root = tree();
    mkdirSync(join(root, 'tooling/ci'), { recursive: true });
    for (const f of ['assert-alert-disposition.mjs', 'workflow-scan.mjs', 'tree-walk.mjs', 'flutter-release-build.mjs', 'app-set.mjs', 'anchored-run-read.mjs', 'run-page-anchor.mjs']) {
      cpSync(join(CI_DIR, f), join(root, 'tooling/ci', f));
    }
    mkdirSync(join(root, 'tooling/app-yaml'), { recursive: true });
    cpSync(join(CI_DIR, '..', 'app-yaml', 'yaml.mjs'), join(root, 'tooling/app-yaml', 'yaml.mjs'));
    for (const f of ['bounded-retry.mjs', 'check-code-scanning-age.mjs', 'credential-origin.mjs']) cpSync(join(CI_DIR, '..', 'ops', f), join(root, 'tooling/ops', f));
    mkdirSync(join(root, 'tooling/generated'), { recursive: true });
    cpSync(join(CI_DIR, '..', 'generated', 'codehost.mjs'), join(root, 'tooling/generated', 'codehost.mjs'));
    write(root, CODEQL_DISPOSITIONS_REL, JSON.stringify({ dispositions: [{ alert: 7, rule: 'js/x', path: 'a.mjs', disposition: 'fixed-in-tree', reason: 'fixed by this change' }] }));
    const file = join(TMP, `probe${seq++}.json`);
    const spawnIn = (claims) => {
      writeFileSync(file, JSON.stringify({ ...green, codeql: { open: [alert(7, 'js/x', 'a.mjs')], dismissed: [] }, codeqlClaims: claims }));
      return spawnSync(process.execPath, [join(root, 'tooling/ci/assert-alert-disposition.mjs'), '--probe-file', file, '--now', NOW], { cwd: root, encoding: 'utf8' });
    };
    const pending = spawnIn({ [SHA]: [] });
    assert.equal(pending.status, 0, `GREEN control — the analysed commit predates the claim:\n${pending.stdout}${pending.stderr}`);
    assert.match(pending.stdout, /1 fixed in tree, awaiting main's analysis/);
    const r = spawnIn({ [SHA]: [7] });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /#7 js\/x a\.mjs:1 is claimed `fixed-in-tree`[\s\S]*still finds it/);
  });

  test('parseDispositions refuses a flow-rule entry with no host, a repeat, and an unknown kind', () => {
    const doc = {
      dispositions: [
        { alert: 1, rule: 'js/file-access-to-http', path: 'a.mjs', disposition: 'by-design', reason: 'sends its own token' },
        { alert: 2, rule: 'js/file-access-to-http', path: 'a.mjs', disposition: 'by-design', reason: 'r', host: 'https://api.github.com/x' },
        { alert: 3, rule: 'js/x', path: 'a.mjs', disposition: 'ignored', reason: 'r' },
        { alert: 3, rule: 'js/x', path: 'a.mjs', disposition: 'by-design', reason: 'r' },
        { alert: 4, rule: 'js/x', path: 'a.mjs', disposition: 'by-design', reason: '' },
      ],
    };
    const p = parseDispositions(JSON.stringify(doc)).problems.join('\n');
    assert.match(p, /alert #1\) is a by-design js\/file-access-to-http with no bare `host`/);
    assert.match(p, /alert #2\) is a by-design js\/file-access-to-http with no bare `host`/, 'a URL is not a host');
    assert.match(p, /alert #3\) has disposition "ignored"/);
    assert.match(p, /alert #3\) repeats an alert number/);
    assert.match(p, /alert #4\) has no `reason`/);
    assert.match(p, /alert #4\) is a by-design js\/x\. Only js\/file-access-to-http and js\/http-to-file-access may be kept by design/);
    assert.deepEqual(parseDispositions(JSON.stringify({ dispositions: [{ alert: 5, rule: 'js/file-access-to-http', path: 'a', disposition: 'by-design', reason: 'r', host: ['api.github.com', 'uploads.github.com'] }] })).problems, []);
    assert.match(parseDispositions('{').problems[0], /is not JSON/);
  });

  // ⏱ 2026-10-01 (review 2, finding 7): the Supabase entries named the zone.
  test('a host is the PINNED project or a bare hostname: a zone wildcard, and any other hash, are refused', () => {
    const one = (host) => parseDispositions(JSON.stringify({ dispositions: [{ alert: 6, rule: 'js/file-access-to-http', path: 'a', disposition: 'by-design', reason: 'r', host }] })).problems;
    assert.deepEqual(one(['auth-api.nikatru.com', PINNED_SUPABASE_HOST]), []);
    assert.match(one(['*.supabase.co']).join('\n'), /no bare `host`/);
    assert.match(one([`sha256:${'0'.repeat(64)}`]).join('\n'), /no bare `host`/);
    assert.equal(PINNED_SUPABASE_HOST, `sha256:${SUPABASE_HOSTED_HOST_SHA256}`);
    const wild = REAL.entries.flatMap((e) => [e.host ?? []].flat()).filter((h) => String(h).includes('*'));
    assert.deepEqual(wild, [], 'the committed file still names a wildcard host');
  });
});

// ⏱ 2026-10-01 — #1107 (run 36839022640): the landers' E2E dispatches filled e2e.yml's newest 30 runs, the nightly
// scheduled run fell off an UNFILTERED page, and limb A read COVERAGE LOST on every PR. The query must ask the server
// for scheduled runs only, and that filter must survive into the cross-read and the second source.
describe('limb A reads the firing history as SCHEDULED runs only', () => {
  test('RED if the query loses event=schedule: a page of hand dispatches could hide the nightly run', () => {
    const url = new URL(firingHistoryUrl('o/r', 'e2e.yml'));
    assert.equal(url.searchParams.get('event'), 'schedule', String(url));
    assert.ok(Number(url.searchParams.get('per_page')) > 0, 'per_page must stay, or saturation cannot be told');
  });
  test('the anchored reader re-applies the filter to its other sources (runQueryPredicate)', () => {
    const keep = runQueryPredicate(firingHistoryUrl('o/r', 'e2e.yml'));
    assert.ok(keep, 'runQueryPredicate refused the query, so the cross-read and second source could not apply it');
    assert.equal(keep({ event: 'schedule', head_branch: 'main', status: 'completed', conclusion: 'success' }), true);
    assert.equal(keep({ event: 'workflow_dispatch', head_branch: 'main', status: 'completed', conclusion: 'success' }), false);
  });
});
