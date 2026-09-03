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
// 2026-08-07, against the committed tooling/ops/register.json:662 — the clause
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

import { reconcile, declaredSources, issueFilingJobs, sourceHealth, classify } from '../assert-alert-disposition.mjs';

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
    write(root, OPSWATCH, read(root, OPSWATCH).replace("if: failure() && github.event_name == 'schedule'", "if: github.event_name == 'schedule'"));
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

  test('M11 no token at all — "I could not look" must never read as "it is fine"', () => {
    const r = runGuard(null);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /neither GITHUB_TOKEN nor GH_TOKEN is in the environment/);
    assert.doesNotMatch(r.stderr, /SyntaxError|ReferenceError|TypeError/);
  });

  test('M12 the issue enumeration itself fails', () => {
    const r = runGuard({ issuesError: 'GitHub API returned 403 for /repos/x/issues' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /the firing history is NOT readable/);
  });

  test('M13 a declared source has no scheduled run history — unreadable, not healthy', () => {
    const r = runGuard({
      issues: [],
      runs: { 'e2e.yml': [{ id: 1, event: 'workflow_dispatch', conclusion: 'success', created_at: NOW }], 'ops-watch.yml': [{ id: 2, event: 'schedule', conclusion: 'success', created_at: NOW }] },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /could not be read: no scheduled run in the sampled history/);
  });

  test('M14 the open-issue enumeration returns a non-list', () => {
    const r = runGuard({ issues: { not: 'a list' }, runs: {} });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /did not return a list/);
  });
});

describe('[14]O-5 · LIMB B — prints the gap, and must NOT fail the build', () => {
  const scheduled = (id, conclusion) => ({ id, event: 'schedule', conclusion, created_at: '2026-08-07T06:00:00Z' });
  const issue = (number, title, created_at) => ({ number, title, created_at, state: 'open' });
  const runGuard = (probe) => {
    const file = join(TMP, `probe${seq++}.json`);
    writeFileSync(file, JSON.stringify(probe));
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
