// ─────────────────────────────────────────────────────────────────────────────
// codeql-pr-no-new-high.test.mjs — assert-codeql-pr-no-new-high.mjs must FAIL
// when a pull request's own CodeQL analysis adds a high or critical alert, and
// must refuse (exit 2, never 0) when it cannot read that analysis.
//
// The RED case is a real one, not an invented one: PR #1071 (merged
// 2026-09-30T03:09Z) added #522 and #523, both `high`, and its CodeQL analysis
// 1863481982 of merge commit eae6ab6e reported them before the merge. Its head
// was b803d487 — the merge commit's second parent, which is how the guard finds
// the analysis when the merge ref has since been recomputed. Measured with
// `gh api .../code-scanning/alerts?ref=refs/pull/1071/merge` and
// `.../commits/eae6ab6e…` on 2026-09-30. Replayed below with main's alert list
// as it stood before that merge, the rule would have failed the PR.
//
// Run:  node --test "tooling/ci/test/codeql-pr-no-new-high.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { pickAnalysis, newHighs, gradeNew, CATEGORY } from '../assert-codeql-pr-no-new-high.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-codeql-pr-no-new-high.mjs');

const HEAD = 'b803d4877e5b6e85123e00fae00ca083b91cdc99';
const MERGE = 'eae6ab6e46da75c5c9a7e682617864fa5c9fa929';
const BASE_PARENT = '934028263668036b8e465f477820707649f2ce02';
const OTHER_MERGE = 'c'.repeat(40);

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-codeql-pr-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const analysis = (commit_sha, extra = {}) => ({ id: 1863481982, commit_sha, created_at: '2026-09-30T00:57:13Z', category: CATEGORY, tool: { name: 'CodeQL' }, error: '', results_count: 8, ...extra });
const alert = (number, sev, extra = {}) => ({
  number,
  state: 'open',
  rule: { id: 'js/incomplete-sanitization', security_severity_level: sev },
  most_recent_instance: { location: { path: 'tooling/ops/check-tech-currency.mjs', start_line: 224 } },
  ...extra,
});
const event = (base = 'main') => ({ number: 1071, pull_request: { number: 1071, head: { sha: HEAD }, base: { ref: base } } });
/** #528 as it really is: a medium flow alert. #529: a warning-level quality note. */
const FLOW_PATH = 'tooling/ops/verify-password-reset-revokes.mjs';
const flow = (n) => alert(n, 'medium', { rule: { id: 'js/file-access-to-http', security_severity_level: 'medium' }, most_recent_instance: { location: { path: FLOW_PATH, start_line: 189 } } });
const note = (n) => alert(n, null, { rule: { id: 'js/missing-space-in-concatenation', severity: 'warning' }, most_recent_instance: { location: { path: 'extensions/scripts/test/selftest.node.js', start_line: 412 } } });
const PR1071 = [alert(523, 'high'), alert(522, 'high'), flow(528), note(529)];
/** A dispositions file, as the PR's own tree would hold it. */
const dispositions = (...entries) => JSON.stringify({ dispositions: entries });
const byDesign = (n, extra = {}) => ({ alert: n, rule: 'js/file-access-to-http', path: FLOW_PATH, disposition: 'by-design', host: 'auth-api.nikatru.com', reason: 'sends the key to its own issuer', ...extra });

let seq = 0;
function run(probe, env = {}) {
  const file = join(TMP, `probe${seq++}.json`);
  writeFileSync(file, JSON.stringify(probe));
  const base = { ...process.env };
  delete base.GITHUB_TOKEN;
  delete base.GH_TOKEN;
  return spawnSync(process.execPath, [GUARD, '--probe-file', file], { encoding: 'utf8', env: { ...base, ...env } });
}
const probe = (extra = {}) => ({
  eventName: 'pull_request',
  event: event(),
  mergeSha: MERGE,
  analyses: [[analysis(MERGE)]],
  parents: { [MERGE]: [BASE_PARENT, HEAD] },
  prAlerts: PR1071,
  mainOpen: [alert(14, 'high')],
  mainDismissed: [],
  dispositionsText: dispositions(),
  ...extra,
});

describe('the rule fails a PR that adds a high alert', () => {
  test('RED: PR #1071 replayed — #522 and #523 are new highs → exit 1, both named', () => {
    const r = run(probe());
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /PR #1071 ADDS 2 CRITICAL\/HIGH CODEQL ALERT\(S\)/);
    assert.match(r.stderr, /#523 {2}js\/incomplete-sanitization {2}high {2}tooling\/ops\/check-tech-currency\.mjs:224/);
    assert.match(r.stderr, /#522 /);
    // ⏱ 2026-09-30: and its medium and its note — both new, neither dispositioned
    // in its own file — fail it too, instead of reddening every PR after the merge.
    assert.match(r.stderr, /ADDS 2 CODEQL ALERT\(S\) ITS OWN tooling\/ci\/codeql-dispositions\.json DOES NOT DISPOSITION/);
    assert.match(r.stderr, /#528 {2}js\/file-access-to-http {2}medium/);
    assert.match(r.stderr, /#529 {2}js\/missing-space-in-concatenation {2}warning/);
  });

  test('RED: a critical counts as well as a high', () => {
    const r = run(probe({ prAlerts: [alert(600, 'critical')] }));
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /#600 .*critical/);
  });

  test('GREEN control: the same alerts already open on main are not NEW → exit 0', () => {
    const r = run(probe({ mainOpen: PR1071 }));
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /PR #1071 adds 0 new CodeQL alert\(s\)/);
  });

  test('an alert already DISMISSED on main is not new either', () => {
    const r = run(probe({ mainDismissed: PR1071.map((a) => ({ ...a, state: 'dismissed' })) }));
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
});

describe('every new alert is graded against the PR\'s OWN dispositions file (review of #1087, finding 2)', () => {
  test('RED: a new MEDIUM flow alert with no disposition fails its own PR', () => {
    const r = run(probe({ prAlerts: [flow(528)] }));
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /ADDS 1 CODEQL ALERT\(S\) ITS OWN tooling\/ci\/codeql-dispositions\.json DOES NOT DISPOSITION/);
    assert.match(r.stderr, /#528 {2}js\/file-access-to-http {2}medium/);
  });

  test('GREEN: the same alert with a by-design entry in the same PR passes', () => {
    const r = run(probe({ prAlerts: [flow(528)], dispositionsText: dispositions(byDesign(528)) }));
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /new #528 js\/file-access-to-http .* by-design in this PR's/);
    assert.match(r.stdout, /adds 1 new CodeQL alert\(s\), every one dispositioned in its own file/);
  });

  test('RED: an entry naming the right number at a DIFFERENT path does not answer it', () => {
    const r = run(probe({ prAlerts: [flow(528)], dispositionsText: dispositions(byDesign(528, { path: 'tooling/ops/elsewhere.mjs' })) }));
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /#528 /);
  });

  test('RED: a new NOTE cannot be kept by design — the PR\'s file is refused', () => {
    const r = run(probe({ prAlerts: [note(529)], dispositionsText: dispositions({ alert: 529, rule: 'js/missing-space-in-concatenation', path: 'extensions/scripts/test/selftest.node.js', disposition: 'by-design', reason: 'r' }) }));
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /is a by-design js\/missing-space-in-concatenation\. Only js\/file-access-to-http and js\/http-to-file-access may be kept by design/);
  });

  test('RED: a new HIGH fails even with a by-design entry in the PR\'s file', () => {
    const high = alert(700, 'high', { rule: { id: 'js/file-access-to-http', security_severity_level: 'high' }, most_recent_instance: { location: { path: FLOW_PATH, start_line: 1 } } });
    const r = run(probe({ prAlerts: [high], dispositionsText: dispositions(byDesign(700)) }));
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /ADDS 1 CRITICAL\/HIGH CODEQL ALERT\(S\) — never dispositionable here/);
  });

  test('gradeNew: highs, answered and unanswered are three disjoint piles', () => {
    const v = gradeNew([alert(1, 'high'), flow(2), flow(3), note(4), alert(5, 'high')], [alert(5, 'high')], [byDesign(2)]);
    assert.deepEqual(v.highs.map((a) => a.number), [1]);
    assert.deepEqual(v.dispositioned.map((a) => a.number), [2]);
    assert.deepEqual(v.undispositioned.map((a) => a.number), [3, 4]);
  });

  test('the recomputed merge ref: found by the merge commit\'s second parent', () => {
    const r = run(probe({ mergeSha: OTHER_MERGE }));
    assert.equal(r.status, 1, `the analysis of ${MERGE.slice(0, 8)} is this head's, so its highs are graded:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /analysis 1863481982 of eae6ab6e46da/);
  });
});

describe('it never passes on an analysis it could not read (exit 2)', () => {
  test('the analysis never appears → COVERAGE LOST', () => {
    const r = run(probe({ analyses: [[]], maxPolls: 2 }));
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST \(exit 2\) — no CodeQL analysis/);
  });

  test('an analysis of ANOTHER head is not this PR\'s → COVERAGE LOST, not a pass', () => {
    const r = run(probe({ mergeSha: OTHER_MERGE, parents: { [MERGE]: [BASE_PARENT, 'd'.repeat(40)] }, maxPolls: 1 }));
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  });

  test('it waits: the analysis appears on the second poll', () => {
    const r = run(probe({ analyses: [[], [analysis(MERGE)]] }));
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /waiting for CodeQL's analysis/);
  });

  test('an analysis that reported an error → COVERAGE LOST', () => {
    const r = run(probe({ analyses: [[analysis(MERGE, { error: 'extraction failed' })]] }));
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /reported an error: extraction failed/);
  });

  test('no token in live mode → COVERAGE LOST', () => {
    const file = join(TMP, `event${seq++}.json`);
    writeFileSync(file, JSON.stringify(event()));
    const base = { ...process.env };
    delete base.GITHUB_TOKEN;
    delete base.GH_TOKEN;
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8', env: { ...base, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file, GITHUB_SHA: MERGE } });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /neither GH_TOKEN nor GITHUB_TOKEN/);
  });

  test('no event at all (a run outside Actions) → COVERAGE LOST, never a pass', () => {
    const r = run(probe({ eventName: undefined }));
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /GITHUB_EVENT_NAME is not set/);
  });

  test('a PR event with no head SHA → COVERAGE LOST', () => {
    const r = run(probe({ event: { number: 1071, pull_request: { number: 1071, base: { ref: 'main' } } } }));
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  });
});

describe('a push is not graded, and says so; a stacked PR is', () => {
  test('a push has no PR analysis → exit 0, printed', () => {
    const r = run(probe({ eventName: 'push' }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /not a pull request — there is no PR analysis to read/);
  });

  test('RED: a stacked PR (base not main) is GRADED, not skipped — its new highs fail it', () => {
    const r = run(probe({ event: event('fix/codeql-alerts-origin') }));
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /PR #1071 is stacked on "fix\/codeql-alerts-origin"/);
    assert.match(r.stderr, /#523 /);
  });
});

describe('the pure halves', () => {
  test('pickAnalysis ignores another tool and another category', async () => {
    const got = await pickAnalysis(
      [analysis(MERGE, { tool: { name: 'Trivy' } }), analysis(MERGE, { category: '/language:python' })],
      { mergeSha: MERGE, headSha: HEAD, parentsOf: async () => [BASE_PARENT, HEAD] },
    );
    assert.equal(got, null);
  });

  test('newHighs: only open, only high/critical, only numbers main does not know', () => {
    const got = newHighs([alert(1, 'high'), alert(2, 'high', { state: 'dismissed' }), alert(3, 'medium'), alert(4, 'critical')], [alert(4, 'critical')]);
    assert.deepEqual(got.map((a) => a.number), [1]);
  });
});
