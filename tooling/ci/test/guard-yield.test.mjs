// ─────────────────────────────────────────────────────────────────────────────
// guard-yield.test.mjs — tooling/ops/guard-yield.mjs and the `--yield` mode of
// tooling/ops/triage-failed-runs.mjs must be able to FAIL, and must count what
// the definition says and nothing else.
//
// Row O-GUARD-YIELD-UNMEASURED. The red controls of the design, by number:
//   R2  one `catches` set to evidence.length + 1   → --check exit 1
//   R4  assert-yield-alpha failing on PR 1 twice (merged), on PR 2 (never
//       merged), and in an infrastructure-classified run on PR 3 (merged)
//                                                    → alpha catches 1 (PR 1),
//                                                      unattributed 0
//   R5  a failing step with no FAILED line whose Run header runs TWO scripts
//                                                    → unattributed 1
// R1 and R3 (the index guard's limb) are in enforcement-index.test.mjs.
//
// ⚠️ NOTHING HERE TOUCHES THE NETWORK OR GITHUB. The CLI runs through the
// fixture transport; the two live-shaped cases stub `fetch` or hand-build the
// transport. Every guard filename below is INVENTED (assert-yield-alpha/beta/
// gamma): assert-guard-coverage reads a real guard's name in this directory as
// that guard's recorded failing case.
//
// Run:  node --test tooling/ci/test/guard-yield.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  YIELD_REL,
  failedNames,
  runHeaderScripts,
  basenameMap,
  attributeStep,
  buildYield,
  checkYield,
  syncYield,
  recountZero,
  serialiseYield,
} from '../../ops/guard-yield.mjs';
import { isNonDefect, prOfRun, mergedPrsFromSubjects, yieldRecords, liveApi, parseArgs, CoverageLost } from '../../ops/triage-failed-runs.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const TRIAGE = join(REPO, 'tooling', 'ops', 'triage-failed-runs.mjs');
const YIELD = join(REPO, 'tooling', 'ops', 'guard-yield.mjs');

const temps = [];
function temp() {
  const d = mkdtempSync(join(tmpdir(), 'guard-yield-'));
  temps.push(d);
  return d;
}
after(() => {
  for (const d of temps) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* a leaked temp dir must never fail a suite */
    }
  }
});

/** An environment built FROM SCRATCH, so no credential on this machine can
 *  reach the script: the fixture transport is the only path. */
function run(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NIKATRU_VAULT: join(temp(), 'absent.env') },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE FIXTURE INDEX — three WIRED guards, one LIBRARY guard, a script, a lane
// ═══════════════════════════════════════════════════════════════════════════
const ALPHA = 'tooling/ci/assert-yield-alpha.mjs';
const BETA = 'tooling/ci/assert-yield-beta.mjs';
const GAMMA = 'tooling/ci/assert-yield-gamma.mjs';
const HELPER = 'tooling/ci/yield-helper.mjs';
const SCRIPT = 'tooling/ops/yield-script.mjs';
const LANE = '.github/workflows/ci.yml#yield-lane';
const row = (ref, kind, state) => ({ claims: [], invokedBy: state === 'WIRED' ? ['.github/workflows/ci.yml#guards'] : [], kind, ref, references: [], state });
const INDEX = [row(LANE, 'lane', 'WIRED'), row(ALPHA, 'guard', 'WIRED'), row(BETA, 'guard', 'WIRED'), row(GAMMA, 'guard', 'WIRED'), row(HELPER, 'guard', 'LIBRARY'), row(SCRIPT, 'script', 'WIRED')];

const CAUSES = [
  { signature: 'guard-failed:*', rootCause: 'A guard refused the branch.', fix: 'superseded: fixed on the branch before merge', fixedBy: { kind: 'superseded', by: 'the branch, before its merge' } },
  { signature: 'guard-refused:*', rootCause: 'A guard refused the branch.', fix: 'superseded: fixed on the branch before merge', fixedBy: { kind: 'superseded', by: 'the branch, before its merge' } },
  { signature: 'github-api:403-installation-quota', rootCause: 'The shared quota.', fix: 'infrastructure, self-cleared (the quota resets hourly)', fixedBy: { kind: 'infrastructure' } },
];

const CI = '.github/workflows/ci.yml';
const at = (d, t) => `2026-09-${d}T${t}Z`;
const logLine = (d, t, text) => `${at(d, t)} ${text}`;

/** One failed ci.yml run: job <id>1 fails at `stepName`, ci-gate <id>2 fails downstream. */
function failedRun(dir, { id, pr, d, branch = `feat-${id}`, stepName, log, event = 'pull_request', path = CI, conclusion = 'failure' }) {
  writeFileSync(
    join(dir, `${id}.jobs.json`),
    JSON.stringify({
      total_count: 2,
      jobs: [
        { id: id * 10 + 1, name: 'Guards', conclusion: 'failure', steps: [{ name: 'Checkout', conclusion: 'success', started_at: at(d, '10:00:00'), completed_at: at(d, '10:00:30') }, { name: stepName, conclusion: 'failure', started_at: at(d, '10:01:00'), completed_at: at(d, '10:01:30') }] },
        { id: id * 10 + 2, name: 'ci-gate', conclusion: 'failure', steps: [{ name: 'Require all lanes green', conclusion: 'failure', started_at: at(d, '10:05:00'), completed_at: at(d, '10:05:10') }] },
      ],
    }),
  );
  writeFileSync(join(dir, `${id}.job-${id * 10 + 1}.log`), log.map(([t, text]) => logLine(d, t, text)).join('\n'));
  return { id, path, workflow_id: 1, event, conclusion, head_branch: branch, head_sha: 'aaaaaaaa', run_attempt: 1, created_at: at(d, '10:00:00'), updated_at: at(d, '10:06:00'), pull_requests: pr ? [{ number: pr }] : [] };
}

const ALPHA_FAILS = [
  ['10:01:00.1000000', `##[group]Run node ${ALPHA}`],
  ['10:01:00.2000000', 'shell: /usr/bin/bash -e {0}'],
  ['10:01:00.3000000', '##[endgroup]'],
  ['10:01:05.0000000', '✗ fixture subject — 1 problem(s):'],
  ['10:01:05.1000000', '    the thing it guards is wrong'],
  ['10:01:05.2000000', 'assert-yield-alpha: FAILED'],
  ['10:01:05.3000000', '##[error]Process completed with exit code 1.'],
];

/** R4's world: the definition's three exclusions around one real catch, plus
 *  three runs every filter must drop (a push run, another workflow, a cancel). */
function r4Fixture() {
  const dir = temp();
  const runs = [
    failedRun(dir, { id: 2001, pr: 1, d: '10', stepName: 'Guard alpha', log: ALPHA_FAILS }),
    failedRun(dir, { id: 2002, pr: 1, d: '11', stepName: 'Guard alpha', log: ALPHA_FAILS }),
    failedRun(dir, { id: 2003, pr: 2, d: '12', stepName: 'Guard alpha', log: ALPHA_FAILS }),
    failedRun(dir, {
      id: 2004,
      pr: 3,
      d: '13',
      stepName: 'Guard alpha',
      log: [
        ['10:01:00.1000000', `##[group]Run node ${ALPHA}`],
        ['10:01:05.0000000', '✗ COVERAGE LOST — GitHub API returned 403 for /repos/x/y'],
        ['10:01:05.1000000', 'assert-yield-alpha: FAILED'],
      ],
    }),
    failedRun(dir, { id: 2005, pr: 9, d: '14', branch: 'main', stepName: 'Guard alpha', log: ALPHA_FAILS, event: 'push' }),
    failedRun(dir, { id: 2006, pr: 9, d: '15', stepName: 'Guard alpha', log: ALPHA_FAILS, path: '.github/workflows/extensions-ci.yml' }),
    failedRun(dir, { id: 2007, pr: 9, d: '16', stepName: 'Guard alpha', log: ALPHA_FAILS, conclusion: 'cancelled' }),
  ];
  writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs));
  writeFileSync(join(dir, 'merged.json'), JSON.stringify([1, 3, 9]));
  writeFileSync(join(dir, 'added.json'), JSON.stringify({ [BETA]: '2026-09-15' }));
  writeFileSync(join(dir, 'causes.json'), JSON.stringify({ causes: CAUSES }));
  return dir;
}

/** R5's world: two scripts in one Run header and no FAILED line (unattributed),
 *  beside the green control — ONE script, no FAILED line (attributed by rule 2). */
function r5Fixture() {
  const dir = temp();
  const runs = [
    failedRun(dir, {
      id: 3001,
      pr: 4,
      d: '10',
      stepName: 'Two guards, one step',
      log: [
        ['10:01:00.1000000', `##[group]Run node ${ALPHA}`],
        ['10:01:00.1500000', `node ${BETA}`],
        ['10:01:00.2000000', '##[endgroup]'],
        ['10:01:05.0000000', '✗ fixture subject — 1 problem(s):'],
        ['10:01:05.3000000', '##[error]Process completed with exit code 1.'],
      ],
    }),
    failedRun(dir, {
      id: 3002,
      pr: 5,
      d: '11',
      stepName: 'Guard gamma',
      log: [
        ['10:01:00.1000000', `##[group]Run node ${GAMMA}`],
        ['10:01:00.2000000', '##[endgroup]'],
        ['10:01:05.0000000', '✗ fixture subject — 1 problem(s):'],
        ['10:01:05.3000000', '##[error]Process completed with exit code 1.'],
      ],
    }),
  ];
  writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs));
  writeFileSync(join(dir, 'merged.json'), JSON.stringify([4, 5]));
  writeFileSync(join(dir, 'causes.json'), JSON.stringify({ causes: CAUSES }));
  return dir;
}

function rootWith(index = INDEX) {
  const root = temp();
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'enforcement-index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return root;
}

const yieldRun = (fixture, root) =>
  run(TRIAGE, ['--yield', '--fixture-dir', fixture, '--causes', join(fixture, 'causes.json'), '--root', root, '--since', '2026-09-01T00:00:00Z', '--until', '2026-09-20T00:00:00Z']);
const readDoc = (root) => JSON.parse(readFileSync(join(root, YIELD_REL), 'utf8'));
const writeDoc = (root, doc) => writeFileSync(join(root, YIELD_REL), serialiseYield(doc));

/** A root holding a file the R4 fetch wrote — the green control every --check case mutates. */
function writtenRoot() {
  const root = rootWith();
  const r = yieldRun(r4Fixture(), root);
  assert.equal(r.code, 0, r.out);
  return root;
}

// ═══════════════════════════════════════════════════════════════════════════
describe('--yield over the fixture transport (R4, R5)', () => {
  test('R4: two failing runs on ONE merged PR are one catch; the unmerged PR and the infrastructure run are none', () => {
    const root = rootWith();
    const r = yieldRun(r4Fixture(), root);
    assert.equal(r.code, 0, r.out);
    const doc = readDoc(root);
    assert.equal(doc.perRef[ALPHA].catches, 1);
    assert.deepEqual(doc.perRef[ALPHA].evidence, [{ pr: 1, runId: 2001, signature: 'guard-failed:assert-yield-alpha' }]);
    assert.equal(doc.unattributed, 0);
    assert.deepEqual(doc.runs, { considered: 4, excluded: 1, attributed: 3, noPr: 0 });
  });

  test('R4: the push run, the other workflow and the cancelled run are never read', () => {
    const root = rootWith();
    assert.equal(yieldRun(r4Fixture(), root).code, 0);
    const doc = readDoc(root);
    assert.equal(doc.runs.considered, 4, 'only the four failed ci.yml pull_request runs');
    assert.equal(doc.perRef[ALPHA].evidence.some((e) => e.pr === 9), false, 'PR 9 is merged, but none of its runs is a failed ci.yml pull_request run');
  });

  test('R4: every index ref is keyed, zeroCatch counts guard/WIRED only, and the window and firstSeen are stated', () => {
    const root = rootWith();
    const r = yieldRun(r4Fixture(), root);
    assert.equal(r.code, 0, r.out);
    const doc = readDoc(root);
    assert.deepEqual(Object.keys(doc.perRef), [LANE, ALPHA, BETA, GAMMA, HELPER, SCRIPT].sort());
    assert.equal(doc.zeroCatch, 2, 'beta and gamma; the LIBRARY guard, the script and the lane are not counted');
    assert.deepEqual(doc.window, { since: '2026-09-01T00:00:00Z', until: '2026-09-20T00:00:00Z', mergedPrs: 3 });
    assert.equal(doc.asOf, '2026-09-20');
    assert.equal(doc.apiCalls, 0);
    assert.equal(doc.perRef[BETA].firstSeen, '2026-09-15', 'added inside the window');
    assert.equal(doc.perRef[ALPHA].firstSeen, '2026-09-01', 'there before the window opened');
    assert.match(r.out, /ZERO CATCH: 2 of 3 guard\/WIRED/);
    assert.match(r.out, /API CALLS: 0/);
  });

  test('R5: a failing step with no FAILED line and a TWO-script Run header is unattributed, counted and listed', () => {
    const root = rootWith();
    const r = yieldRun(r5Fixture(), root);
    assert.equal(r.code, 0, r.out);
    const doc = readDoc(root);
    assert.equal(doc.unattributed, 1);
    assert.deepEqual(doc.unattributedRuns, [{ pr: 4, runId: 3001, signature: 'guard-refused:fixture subject' }]);
    assert.equal(doc.perRef[ALPHA].catches, 0);
    assert.equal(doc.perRef[BETA].catches, 0);
    assert.match(r.out, /unattributed: run 3001 · PR 4/);
  });

  test('R5 GREEN CONTROL: the same shape with ONE script in the Run header is attributed to it (rule 2)', () => {
    const root = rootWith();
    assert.equal(yieldRun(r5Fixture(), root).code, 0);
    const doc = readDoc(root);
    assert.equal(doc.perRef[GAMMA].catches, 1);
    assert.equal(doc.perRef[GAMMA].evidence[0].runId, 3002);
  });

  test('the file a fixture fetch writes passes --check', () => {
    const root = writtenRoot();
    const r = run(YIELD, ['--check', root]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}guard-yield — 6 ref\(s\) keyed/);
  });

  test('--yield without --since is refused before anything is read (exit 2)', () => {
    const root = rootWith();
    const r = run(TRIAGE, ['--yield', '--fixture-dir', r4Fixture(), '--root', root]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /--yield needs --since/);
    assert.equal(existsSync(join(root, YIELD_REL)), false);
  });

  test('--yield with no index under --root is COVERAGE LOST and writes nothing', () => {
    const root = temp();
    const fixture = r4Fixture();
    const r = run(TRIAGE, ['--yield', '--fixture-dir', fixture, '--causes', join(fixture, 'causes.json'), '--root', root, '--since', '2026-09-01T00:00:00Z']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/enforcement-index\.json could not be read/);
    assert.equal(existsSync(join(root, YIELD_REL)), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('guard-yield.mjs --check (R2) and --zero-count', () => {
  test('R2: one catches set to evidence.length + 1 is exit 1, naming the ref', () => {
    const root = writtenRoot();
    const doc = readDoc(root);
    doc.perRef[ALPHA].catches = doc.perRef[ALPHA].evidence.length + 1;
    writeDoc(root, doc);
    const r = run(YIELD, ['--check', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"tooling\/ci\/assert-yield-alpha\.mjs" says catches 2 and lists 1 evidence row/);
  });

  test('an index ref the file does not key is exit 1, naming the ref and --sync', () => {
    const root = writtenRoot();
    const doc = readDoc(root);
    delete doc.perRef[GAMMA];
    writeDoc(root, doc);
    const r = run(YIELD, ['--check', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"tooling\/ci\/assert-yield-gamma\.mjs" is an index ref and tooling\/guard-yield\.json has no entry/);
    assert.match(r.out, /node tooling\/ops\/guard-yield\.mjs --sync/);
  });

  test('a key the index does not carry is exit 1', () => {
    const root = writtenRoot();
    const doc = readDoc(root);
    doc.perRef['tooling/ci/assert-yield-ghost.mjs'] = { catches: 0, firstSeen: '2026-09-01', evidence: [] };
    writeDoc(root, doc);
    const r = run(YIELD, ['--check', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /keys "tooling\/ci\/assert-yield-ghost\.mjs", which is not an index ref/);
  });

  test('a zeroCatch that disagrees with the recount is exit 1', () => {
    const root = writtenRoot();
    const doc = readDoc(root);
    doc.zeroCatch = 3;
    writeDoc(root, doc);
    const r = run(YIELD, ['--check', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /says zeroCatch 3; recounted over the index's guard\/WIRED rows it is 2/);
  });

  test('one PR listed twice as evidence is exit 1, even with catches equal to the list', () => {
    const root = writtenRoot();
    const doc = readDoc(root);
    doc.perRef[ALPHA].evidence.push({ pr: 1, runId: 2002, signature: 'guard-failed:assert-yield-alpha' });
    doc.perRef[ALPHA].catches = 2;
    writeDoc(root, doc);
    const r = run(YIELD, ['--check', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lists one PR twice/);
  });

  test('an unattributed count with its runs dropped from the list is exit 1', () => {
    const root = writtenRoot();
    const doc = readDoc(root);
    doc.unattributed = 1;
    writeDoc(root, doc);
    const r = run(YIELD, ['--check', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /says unattributed 1 and lists 0 unattributed run/);
  });

  test('the file ABSENT is COVERAGE LOST, exit 2 — never a pass', () => {
    const r = run(YIELD, ['--check', rootWith()]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/guard-yield\.json could not be read/);
  });

  test('the file UNPARSEABLE is COVERAGE LOST, exit 2', () => {
    const root = rootWith();
    writeFileSync(join(root, YIELD_REL), '{ "perRef": { }\n');
    const r = run(YIELD, ['--check', root]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/guard-yield\.json is not valid JSON/);
  });

  test('--zero-count prints zeroCatch alone', () => {
    const r = run(YIELD, ['--zero-count', writtenRoot()]);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.trim(), '2');
  });

  test('--zero-count over a file that fails --check prints no number and exits 1', () => {
    const root = writtenRoot();
    const doc = readDoc(root);
    doc.zeroCatch = 0;
    writeDoc(root, doc);
    const r = run(YIELD, ['--zero-count', root]);
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /^0$/m);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('guard-yield.mjs --sync', () => {
  test('--sync over an index with one ref added and one removed keys it again, and --check then passes', () => {
    const root = writtenRoot();
    const grown = [...INDEX.filter((r) => r.ref !== GAMMA), row('tooling/ci/assert-yield-delta.mjs', 'guard', 'WIRED')];
    writeFileSync(join(root, 'tooling', 'enforcement-index.json'), `${JSON.stringify(grown, null, 2)}\n`);
    assert.equal(run(YIELD, ['--check', root]).code, 1, 'the green control: the unsynced file must be red first');
    const s = run(YIELD, ['--sync', root]);
    assert.equal(s.code, 0, s.out);
    assert.match(s.out, /\+ tooling\/ci\/assert-yield-delta\.mjs/);
    assert.match(s.out, /− tooling\/ci\/assert-yield-gamma\.mjs/);
    const doc = readDoc(root);
    assert.equal(Object.hasOwn(doc.perRef, GAMMA), false);
    assert.equal(doc.perRef['tooling/ci/assert-yield-delta.mjs'].catches, 0);
    assert.equal(doc.perRef['tooling/ci/assert-yield-delta.mjs'].firstSeen, new Date().toISOString().slice(0, 10));
    assert.deepEqual(doc.perRef[ALPHA].evidence, [{ pr: 1, runId: 2001, signature: 'guard-failed:assert-yield-alpha' }], 'an existing entry is kept untouched');
    assert.equal(run(YIELD, ['--check', root]).code, 0);
  });

  test('syncYield: the new ref is dated by the day given, and zeroCatch is recounted without it (unmeasured, PE2-F3)', () => {
    const doc = buildYield({ records: [], indexRows: INDEX, merged: new Set(), since: '2026-09-01T00:00:00Z', until: '2026-09-20T00:00:00Z' });
    assert.equal(doc.zeroCatch, 3);
    const { doc: next, added, removed } = syncYield(doc, [...INDEX, row('tooling/ci/assert-yield-delta.mjs', 'guard', 'WIRED')], '2026-09-25');
    assert.deepEqual(added, ['tooling/ci/assert-yield-delta.mjs']);
    assert.deepEqual(removed, []);
    assert.deepEqual(next.perRef['tooling/ci/assert-yield-delta.mjs'], { catches: 0, firstSeen: '2026-09-25', evidence: [] });
    assert.equal(next.zeroCatch, 3, 'a ref keyed after the window is unmeasured, not a zero');
  });

  test('PE2-F3: a guard/WIRED ref --sync keys after the fetch is UNMEASURED — --zero-count does not move, and --check names it', () => {
    const root = writtenRoot();
    const before = run(YIELD, ['--zero-count', root]);
    assert.equal(before.code, 0, before.out);
    writeFileSync(join(root, 'tooling', 'enforcement-index.json'), `${JSON.stringify([...INDEX, row('tooling/ci/assert-yield-delta.mjs', 'guard', 'WIRED')], null, 2)}\n`);
    assert.equal(run(YIELD, ['--sync', root]).code, 0);
    assert.equal(readDoc(root).perRef['tooling/ci/assert-yield-delta.mjs'].catches, 0, 'the new guard/WIRED ref has no catch');
    const after = run(YIELD, ['--zero-count', root]);
    assert.equal(after.code, 0, after.out);
    assert.equal(after.out.trim(), before.out.trim(), 'a guard added after the window is not a zero');
    const c = run(YIELD, ['--check', root]);
    assert.equal(c.code, 0, c.out);
    assert.match(c.out, /unmeasured: tooling\/ci\/assert-yield-delta\.mjs/);
  });

  test('--sync with no file is COVERAGE LOST: it never invents a window', () => {
    const root = rootWith();
    const r = run(YIELD, ['--sync', root]);
    assert.equal(r.code, 2, r.out);
    assert.equal(existsSync(join(root, YIELD_REL)), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('attribution', () => {
  const REFS = INDEX.map((r) => r.ref);
  const byBase = basenameMap(REFS);
  const refSet = new Set(REFS);

  test('rule 1: a step naming two guards credits both', () => {
    const lines = ['✗ two subjects — 2 problem(s):', 'assert-yield-beta: FAILED', 'assert-yield-gamma: FAILED'];
    assert.deepEqual(attributeStep(lines, byBase, refSet), { refs: [BETA, GAMMA], rule: 1 });
  });

  test('rule 1 wins over the Run header: a shard that ran three scripts is attributed by its FAILED line', () => {
    const lines = [`##[group]Run node ${ALPHA} && node ${BETA} && node ${GAMMA}`, '##[endgroup]', 'assert-yield-beta: FAILED'];
    assert.deepEqual(attributeStep(lines, byBase, refSet), { refs: [BETA], rule: 1 });
  });

  test('a FAILED line quoted INDENTED under a failing test is not that guard’s catch', () => {
    const lines = ['##[group]Run node --test "tooling/ci/test/*.test.mjs"', '##[endgroup]', '✖ the guard refuses (3ms)', '    assert-yield-gamma: FAILED'];
    assert.deepEqual(failedNames(lines), []);
    assert.deepEqual(attributeStep(lines, byBase, refSet), { refs: [], rule: 0 });
  });

  test('a FAILED line naming no index ref falls to rule 2', () => {
    const lines = [`##[group]Run node ${ALPHA}`, '##[endgroup]', 'apple-signing: FAILED'];
    assert.deepEqual(attributeStep(lines, byBase, refSet), { refs: [ALPHA], rule: 2 });
  });

  test('rule 2 reads `node` inside a command substitution, and stops at the group end', () => {
    const lines = [`##[group]Run out="$(node ${GAMMA} 2>&1)"`, 'echo "$out"', '##[endgroup]', `the log later mentions node ${ALPHA}`];
    assert.deepEqual(runHeaderScripts(lines), [GAMMA]);
  });

  test('rule 2 attributes nothing to a script that is not an index ref', () => {
    const lines = ['##[group]Run node tooling/scripts/not-indexed.mjs', '##[endgroup]'];
    assert.deepEqual(attributeStep(lines, byBase, refSet), { refs: [], rule: 0 });
  });

  test('a basename two refs share maps to nobody', () => {
    const m = basenameMap(['tooling/ci/assert-yield-twin.mjs', 'tooling/ops/assert-yield-twin.mjs', ALPHA]);
    assert.equal(m.get('assert-yield-twin.mjs'), null);
    assert.equal(m.get('assert-yield-alpha.mjs'), ALPHA);
  });

  test('an attributed run whose PR cannot be named is counted in runs.noPr, never as a catch', () => {
    const doc = buildYield({
      records: [{ runId: 7, pr: null, createdAt: '2026-09-05T00:00:00Z', units: [{ step: 's', lines: ['assert-yield-alpha: FAILED'], signature: 'guard-failed:assert-yield-alpha', excluded: false }] }],
      indexRows: INDEX,
      merged: new Set([1]),
      since: '2026-09-01T00:00:00Z',
      until: '2026-09-20T00:00:00Z',
    });
    assert.equal(doc.perRef[ALPHA].catches, 0);
    assert.deepEqual(doc.runs, { considered: 1, excluded: 0, attributed: 1, noPr: 1 });
    assert.deepEqual(checkYield(doc, INDEX).problems, []);
  });

  test('recountZero ignores a guard/WIRED ref the file does not key', () => {
    assert.equal(recountZero({ [ALPHA]: { catches: 0 } }, INDEX), 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the fetch half: exclusion, the PR of a run, the merged set, the cap', () => {
  test('isNonDefect: the typed fixedBy.kind alone — pe1 makes fixedBy mandatory, so the prose is never read', () => {
    assert.equal(isNonDefect({ fix: 'the quota', fixedBy: { kind: 'infrastructure' } }), true);
    assert.equal(isNonDefect({ fix: 'PR #1', fixedBy: { kind: 'not-a-defect', reason: 'a cancelled run' } }), true);
    assert.equal(isNonDefect({ fix: 'infrastructure, self-cleared', fixedBy: { kind: 'superseded', by: 'the branch' } }), false, 'the typed kind decides, never the text');
    assert.equal(isNonDefect({ fix: 'not a defect: prose', fixedBy: { kind: 'merge', sha: 'abcdef1', pr: 1 } }), false);
    assert.equal(isNonDefect(null), false, 'no cause is not a non-defect');
  });

  test('prOfRun: pull_requests first; else the ONE PR on that branch whose open span covers the run', () => {
    const pulls = [
      { number: 11, head: 'feat-reused', headRepo: 'o/r', created_at: '2026-09-01T00:00:00Z', closed_at: '2026-09-03T00:00:00Z' },
      { number: 12, head: 'feat-reused', headRepo: 'o/r', created_at: '2026-09-05T00:00:00Z', closed_at: null },
    ];
    assert.deepEqual(prOfRun({ pull_requests: [{ number: 7 }], head_branch: 'feat-reused', created_at: '2026-09-02T00:00:00Z' }, pulls), { pr: 7, via: 'run' });
    assert.deepEqual(prOfRun({ pull_requests: [], head_branch: 'feat-reused', created_at: '2026-09-02T00:00:00Z' }, pulls), { pr: 11, via: 'pulls' });
    assert.deepEqual(prOfRun({ pull_requests: [], head_branch: 'feat-reused', created_at: '2026-09-06T00:00:00Z' }, pulls), { pr: 12, via: 'pulls' });
    assert.deepEqual(prOfRun({ pull_requests: [], head_branch: 'feat-reused', created_at: '2026-09-04T00:00:00Z' }, pulls), { pr: null, via: 'none' });
  });

  test('prOfRun: two PRs whose spans both cover the run is no answer', () => {
    const pulls = [
      { number: 21, head: 'feat-x', created_at: '2026-09-01T00:00:00Z', closed_at: null },
      { number: 22, head: 'feat-x', created_at: '2026-09-02T00:00:00Z', closed_at: null },
    ];
    assert.deepEqual(prOfRun({ pull_requests: [], head_branch: 'feat-x', created_at: '2026-09-03T00:00:00Z' }, pulls), { pr: null, via: 'ambiguous' });
  });

  test('the merged set is the `(#N)` that ENDS a subject; a PR cited mid-subject is not merged by it', () => {
    const subjects = ['ci: deploys become call jobs (#947)', 'Revert "guards: x (#12)" (#13)', 'docs: follow-up to (#40) without a number', ''].join('\n');
    assert.deepEqual([...mergedPrsFromSubjects(subjects)].sort((a, b) => a - b), [13, 947]);
  });

  test('parseArgs: ONE ceiling — --yield defaults it to 1500, the ledger to 300, --max-requests sets it, --max-calls is gone; --merged-ref may not be an option', () => {
    assert.equal(parseArgs(['--yield', '--since', '2026-09-01T00:00:00Z']).maxRequests, 1500);
    assert.equal(parseArgs([]).maxRequests, 300);
    assert.equal(parseArgs(['--yield', '--since', '2026-09-01T00:00:00Z', '--max-requests', '900']).maxRequests, 900);
    assert.match(parseArgs(['--yield', '--since', '2026-09-01T00:00:00Z', '--max-requests', '0']).error, /--max-requests must be a whole number from 1/);
    assert.match(parseArgs(['--yield', '--since', '2026-09-01T00:00:00Z', '--max-calls', '1500']).error, /unrecognised argument `--max-calls`/);
    assert.match(parseArgs(['--merged-ref', '--output=x']).error, /plain git ref/);
    assert.match(parseArgs(['--yield', '--since', '2026-09-01T00:00:00Z', '--json', 'x.json']).error, /--json writes the ledger/);
  });

  test('the cap: yieldRecords REFUSES TO START when the projected calls exceed it, and reads no job', async () => {
    let jobsRead = 0;
    const run = (id) => ({ id, path: CI, event: 'pull_request', conclusion: 'failure', created_at: '2026-09-05T00:00:00Z', pull_requests: [{ number: id }] });
    const api = {
      live: true,
      requestsSent: () => 1,
      uncachedRuns: (runs) => runs.length,
      listNonGreen: async () => ({ runs: [run(1), run(2)], capped: [] }),
      listPulls: async () => [],
      listJobs: async () => { jobsRead++; return { total_count: 0, jobs: [] }; },
      jobLog: async () => '',
    };
    await assert.rejects(
      yieldRecords(api, { since: '2026-09-01T00:00:00Z', until: '2026-09-20T00:00:00Z', causes: [], maxCalls: 4 }),
      (e) => e instanceof CoverageLost && /refusing to start: at least 5 API call\(s\) projected/.test(e.message),
    );
    assert.equal(jobsRead, 0);
  });

  test('the cap GREEN CONTROL: the same two runs under a cap of 5 are read', async () => {
    let jobsRead = 0;
    const run = (id) => ({ id, path: CI, event: 'pull_request', conclusion: 'failure', created_at: '2026-09-05T00:00:00Z', pull_requests: [{ number: id }] });
    const api = {
      live: true,
      requestsSent: () => 1,
      uncachedRuns: (runs) => runs.length,
      listNonGreen: async () => ({ runs: [run(1), run(2)], capped: [] }),
      listPulls: async () => [],
      listJobs: async () => { jobsRead++; return { total_count: 0, jobs: [] }; },
      jobLog: async () => '',
    };
    const { records } = await yieldRecords(api, { since: '2026-09-01T00:00:00Z', until: '2026-09-20T00:00:00Z', causes: [], maxCalls: 5 });
    assert.equal(records.length, 2);
    assert.equal(jobsRead, 2);
  });

  test('the failure list is read a WEEK at a time in whole seconds, timed_out once, and a run two slices return is one run', async () => {
    const asked = [];
    const shared = { id: 5, path: CI, event: 'pull_request', conclusion: 'failure', created_at: '2026-09-08T00:00:00Z', pull_requests: [{ number: 5 }] };
    const api = {
      live: true,
      requestsSent: () => 0,
      uncachedRuns: (runs) => runs.length,
      listNonGreen: async (from, to, opts) => { asked.push([from, to, opts.statuses.join(','), opts.event]); return { runs: [shared], capped: [] }; },
      listPulls: async () => [],
      listJobs: async () => ({ total_count: 0, jobs: [] }),
      jobLog: async () => '',
    };
    const { runs } = await yieldRecords(api, { since: '2026-09-01T00:00:00Z', until: '2026-09-20T00:00:00Z', causes: [] });
    assert.deepEqual(asked, [
      ['2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', 'failure', 'pull_request'],
      ['2026-09-08T00:00:00Z', '2026-09-15T00:00:00Z', 'failure', 'pull_request'],
      ['2026-09-15T00:00:00Z', '2026-09-20T00:00:00Z', 'failure', 'pull_request'],
      ['2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z', 'timed_out', 'pull_request'],
    ]);
    assert.equal(runs.length, 1);
  });

  test('a slice the API CAPPED is COVERAGE LOST, naming the slice, before any job is read', async () => {
    let jobsRead = 0;
    const api = {
      live: true,
      requestsSent: () => 0,
      uncachedRuns: (runs) => runs.length,
      listNonGreen: async (from) => ({ runs: [], capped: from === '2026-09-08T00:00:00Z' ? ['failure: 1000 of 1204'] : [] }),
      listPulls: async () => [],
      listJobs: async () => { jobsRead++; return { total_count: 0, jobs: [] }; },
      jobLog: async () => '',
    };
    await assert.rejects(
      yieldRecords(api, { since: '2026-09-01T00:00:00Z', until: '2026-09-20T00:00:00Z', causes: [] }),
      (e) => e instanceof CoverageLost && /CAPPED by the API \(2026-09-08T00:00:00Z\.\.2026-09-15T00:00:00Z failure: 1000 of 1204\)/.test(e.message),
    );
    assert.equal(jobsRead, 0);
  });

  test('the ceiling on the live transport: the request past --max-requests is refused unsent, and the count says so', async () => {
    const seen = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ total_count: 0, jobs: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const api = liveApi('owner/name', 'ghp_' + 'a'.repeat(36), null, { maxRequests: 1 });
      await api.listJobs(1, 1);
      await assert.rejects(api.listJobs(2, 1), (e) => e instanceof CoverageLost && /request ceiling — 1 of 1 request\(s\) sent/.test(e.message));
      assert.equal(seen.length, 1);
      assert.equal(api.requestsSent(), 1);
    } finally {
      globalThis.fetch = real;
    }
  });
});
