// ─────────────────────────────────────────────────────────────────────────────
// lane-detect.test.mjs — lane-detect.mjs must be able to say "run" and "skip" for
// the right reasons, fail open when it cannot see, and its --check must fail. [ADR 095]
//
// Each detect case builds a REAL two-commit git repository in a temp directory and
// runs the script as the callee's detect step runs it: env GITHUB_EVENT_NAME,
// GITHUB_EVENT_PATH (a pull_request payload carrying base.sha and head.sha) and
// GITHUB_OUTPUT. The --check cases run against a copy of the fixture map, and once
// against the real tree, which is the subject guard-meta grades.
//
// Run:  node --test tooling/ci/test/lane-detect.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { globToRegExp, readMap, decide } from '../lane-detect.mjs';
import { parseWorkflow, workflowSteps } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(CI_DIR, 'lane-detect.mjs');

const MAP = {
  _readme: ['fixture'],
  lanes: {
    workers: { globs: ['services/w/**', 'catalog/apps.json'] },
    sites: { globs: ['sites/**'] },
    guards: { globs: ['tooling/**'] },
  },
  unclaimed: ['docs/**', '*.md'],
};

const BASE_FILES = {
  'services/w/a.ts': 'export const a = 1;\n',
  'catalog/apps.json': '[]\n',
  'sites/s.html': '<p>s</p>\n',
  'docs/d.md': '# d\n',
  'README.md': '# r\n',
};

let TMP;
let n = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-lane-detect-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const git = (root, ...args) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/** A repo with the fixture map committed as base, then `changes` committed as head. */
function repo(changes, map = MAP) {
  const root = join(TMP, `r${n++}`);
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  write(root, { ...BASE_FILES, 'tooling/ci/lane-map.json': `${JSON.stringify(map, null, 2)}\n` });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  write(root, changes);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'head');
  const head = git(root, 'rev-parse', 'HEAD');
  return { root, base, head };
}

function detect({ root, base, head }, lane, event = 'pull_request', payloadOverride = null) {
  const payloadPath = join(root, '..', `payload-${n++}.json`);
  const out = join(root, '..', `output-${n++}.txt`);
  writeFileSync(payloadPath, JSON.stringify(payloadOverride ?? { pull_request: { base: { sha: base }, head: { sha: head } } }));
  writeFileSync(out, '');
  const r = spawnSync(process.execPath, [SCRIPT, '--lane', lane, '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: payloadPath, GITHUB_OUTPUT: out },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, output: readFileSync(out, 'utf8') };
}

function check(root) {
  const r = spawnSync(process.execPath, [SCRIPT, '--check', '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function noCrash(res) {
  assert.doesNotMatch(res.out, /\b(SyntaxError|ReferenceError|TypeError|ERR_MODULE_NOT_FOUND)\b/, `the script crashed rather than reporting:\n${res.out}`);
}

describe('lane-detect.mjs --lane — the decision', () => {
  test('a push (not a pull_request) is affected, whatever changed', () => {
    const r = detect(repo({ 'docs/d.md': '# changed\n' }), 'workers', 'push');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /^reason=event is push, not a pull_request/m);
  });

  test('a pull_request changing a path in the lane is affected', () => {
    const r = detect(repo({ 'services/w/a.ts': 'export const a = 2;\n' }), 'workers');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /1 changed path\(s\) in lane workers, first services\/w\/a\.ts/);
  });

  test('a pull_request changing only another lane\'s path is NOT affected', () => {
    const r = detect(repo({ 'sites/s.html': '<p>t</p>\n' }), 'workers');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=false$/m);
  });

  test('a pull_request changing only `unclaimed` paths (docs) is NOT affected', () => {
    const r = detect(repo({ 'docs/d.md': '# changed\n', 'README.md': '# changed\n' }), 'workers');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=false$/m);
    assert.match(r.output, /none of 2 changed path\(s\) is in lane workers, and every one is mapped/);
  });

  test('an unmapped path runs every lane, even beside an unclaimed one (RC1\'s shape)', () => {
    const r = detect(repo({ 'zz-unmapped.txt': 'x\n', 'docs/d.md': '# changed\n' }), 'workers');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /^reason=unmapped zz-unmapped\.txt: a path the map does not name runs every lane$/m);
  });

  test('a diff that cannot be computed fails OPEN, and says why', () => {
    const fixture = repo({ 'docs/d.md': '# changed\n' });
    const r = detect(fixture, 'workers', 'pull_request', { pull_request: { base: { sha: 'f'.repeat(40) }, head: { sha: fixture.head } } });
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /^reason=the diff could not be computed \(git diff f{12}\.\.\.[0-9a-f]{12} failed: .+\): failing open$/m);
  });

  test('a payload without the two shas fails open too — it is not read as an empty diff', () => {
    const r = detect(repo({ 'docs/d.md': '# changed\n' }), 'workers', 'pull_request', { pull_request: {} });
    noCrash(r);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /the payload carries no pull_request\.base\.sha \/ head\.sha/);
  });

  test('a diff naming zero paths fails open rather than skipping', () => {
    const r = detect(repo({}), 'workers');
    noCrash(r);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /the diff named zero paths/);
  });

  test('a lane the map does not name is COVERAGE LOST (exit 2), and writes no output', () => {
    const r = detect(repo({ 'docs/d.md': '# changed\n' }), 'wrokers');
    noCrash(r);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — lane "wrokers" is not in tooling\/ci\/lane-map\.json/);
    assert.equal(r.output, '');
  });
});

describe('lane-detect.mjs --check — the map\'s guard', () => {
  test('the real tree passes: every tracked file is placed and every glob is alive', () => {
    const r = check(REPO);
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^ok {2}lane map — \d+ tracked file\(s\) each claimed/m);
  });

  test('the fixture base passes (so each red below is the mutation, not the fixture)', () => {
    const r = check(repo({}).root);
    noCrash(r);
    assert.equal(r.code, 0, r.out);
  });

  test('a tracked file no entry claims fails (RC8\'s shape: a new service, the map not updated)', () => {
    const r = check(repo({ 'services/new-thing/x.ts': 'export {};\n' }).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /1 tracked file\(s\) match no lane and no `unclaimed` glob in tooling\/ci\/lane-map\.json: services\/new-thing\/x\.ts/);
  });

  test('a glob that matches no tracked file fails — a dead claim reads as coverage', () => {
    const map = { ...MAP, lanes: { ...MAP.lanes, sites: { globs: ['sites/**', 'site/**'] } } };
    const r = check(repo({}, map).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lane "sites" glob "site\/\*\*" matches no tracked file/);
  });

  test('a callee whose detect step names another lane fails', () => {
    const map = { ...MAP, lanes: { ...MAP.lanes, workers: { callee: 'lane-workers.yml', globs: MAP.lanes.workers.globs } } };
    const r = check(repo({ 'lane-workers.yml': 'run: node tooling/ci/lane-detect.mjs --lane sites\n' }, { ...map, unclaimed: [...map.unclaimed, '*.yml'] }).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lane-workers\.yml is lane "workers"'s callee in tooling\/ci\/lane-map\.json, but its detect step runs lane-detect\.mjs for "sites"/);
  });

  test('a callee whose only lane-detect step is commented out names no lane, and fails', () => {
    const map = { ...MAP, lanes: { ...MAP.lanes, workers: { callee: 'lane-workers.yml', globs: MAP.lanes.workers.globs } } };
    const r = check(repo({ 'lane-workers.yml': '      # - run: node tooling/ci/lane-detect.mjs --lane workers\n' }, { ...map, unclaimed: [...map.unclaimed, '*.yml'] }).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /but its detect step runs lane-detect\.mjs for no lane/);
  });

  test('a callee that does not exist fails', () => {
    const map = { ...MAP, lanes: { ...MAP.lanes, workers: { callee: 'lane-gone.yml', globs: MAP.lanes.workers.globs } } };
    const r = check(repo({}, map).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lane "workers" names callee lane-gone\.yml, which does not exist/);
  });

  test('a map with no lanes is COVERAGE LOST (exit 2), not a clean sweep', () => {
    const r = check(repo({}, { lanes: {}, unclaimed: ['**'] }).root);
    noCrash(r);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/ci\/lane-map\.json has no `lanes` object/);
  });
});

describe('globToRegExp — the only syntax the map may use', () => {
  test('`**` spans directories and `*` stays inside one segment', () => {
    assert.equal(globToRegExp('services/w/**').test('services/w/src/deep/a.ts'), true);
    assert.equal(globToRegExp('services/w/**').test('services/wx/a.ts'), false);
    assert.equal(globToRegExp('*.md').test('README.md'), true);
    assert.equal(globToRegExp('*.md').test('docs/d.md'), false);
    assert.equal(globToRegExp('contracts/entitlement/*.d.ts').test('contracts/entitlement/bundle.d.ts'), true);
    assert.equal(globToRegExp('contracts/entitlement/*.d.ts').test('contracts/entitlement/bundleXd.ts'), false);
  });

  test('brace sets and absolute paths are refused, not half-matched', () => {
    assert.throws(() => globToRegExp('contracts/entitlement/*.{js,json}'), /not in the supported syntax/);
    assert.throws(() => globToRegExp('/services/**'), /not in the supported syntax/);
  });
});

// ⏱ 2026-10-01 (ADR 095) — THE TWO DIRECTIONS ci-gate RESTS ON, over the REAL map and
// the REAL workflows. The app jobs run in lane-apps.yml and app-brick in lane-brick.yml,
// each behind a detect job; ci-gate needs the two call jobs, whose result is each
// callee's lane-verdict. A Worker-only pull request must read the app lanes as "not
// needed" (skipped under affected=false, verdict green, ci-gate green), never as
// cancelled or missing; an app pull request must run them. Each case walks the chain
// detect → lane-verdict (the script, as the callee runs it) → ci-gate (its predicate,
// read off ci.yml), with the needs each verdict judges read off the callee itself.
describe('the real map and the gate — a Worker-only PR skips the app lanes green, an app PR runs them', () => {
  const VERDICT = join(CI_DIR, 'lane-verdict.mjs');
  const MAP_REAL = readMap(REPO);
  const CALLEES = { apps: '.github/workflows/lane-apps.yml', brick: '.github/workflows/lane-brick.yml' };

  /** The needs of a callee's lane-verdict job, as written in the callee. */
  const verdictNeeds = (lane) => {
    const wf = parseWorkflow(REPO, CALLEES[lane]);
    assert.ok(wf?.jobs.has('lane-verdict'), `${CALLEES[lane]} has no lane-verdict job`);
    const needs = wf.jobs.get('lane-verdict').needs;
    assert.ok(needs.includes('detect') && needs.length > 1, `${CALLEES[lane]} lane-verdict needs ${needs.join(', ')}`);
    return needs;
  };

  /** The call job's result: the callee's conclusion, which is its lane-verdict's here. */
  function laneResult(lane, changed, work) {
    const { affected, reason } = decide({ map: MAP_REAL, lane, event: 'pull_request', changed });
    const needs = {};
    for (const j of verdictNeeds(lane)) {
      needs[j] = j === 'detect'
        ? { result: 'success', outputs: { affected: String(affected), reason } }
        : { result: work(affected), outputs: {} };
    }
    const env = { ...process.env, LANE_NEEDS: JSON.stringify(needs) };
    const r = spawnSync(process.execPath, [VERDICT], { encoding: 'utf8', env });
    return { affected, verdict: r.status, out: `${r.stdout}${r.stderr}`, result: r.status === 0 ? 'success' : 'failure' };
  }

  /** ci-gate's own predicate, read off ci.yml: red on any failure, cancelled or skipped need. */
  function gate(results) {
    const job = parseWorkflow(REPO, '.github/workflows/ci.yml').jobs.get('ci-gate');
    const run = workflowSteps(job).map((st) => st.run?.text ?? '').join('\n');
    for (const v of ['failure', 'cancelled', 'skipped']) assert.match(run, new RegExp(`contains\\(needs\\.\\*\\.result, '${v}'\\)`), `ci-gate no longer reads ${v}`);
    for (const lane of ['lane-apps', 'lane-brick']) assert.ok(job.needs.includes(lane), `ci-gate does not need ${lane}`);
    return Object.values(results).some((x) => ['failure', 'cancelled', 'skipped'].includes(x)) ? 'red' : 'green';
  }

  // GitHub's behaviour for a job whose `if:` is false: skipped. For a true one: it runs (green here).
  const asGitHubRuns = (affected) => (affected ? 'success' : 'skipped');

  test('a Worker-only PR: the apps and brick lanes are not needed — every app job skipped, both verdicts green, ci-gate green', () => {
    const changed = ['services/platform/src/routes/receipts.ts'];
    assert.equal(decide({ map: MAP_REAL, lane: 'workers', event: 'pull_request', changed }).affected, true, 'the Worker lane must run');
    const apps = laneResult('apps', changed, asGitHubRuns);
    const brick = laneResult('brick', changed, asGitHubRuns);
    assert.equal(apps.affected, false, apps.out);
    assert.equal(brick.affected, false, brick.out);
    assert.equal(apps.verdict, 0, apps.out);
    assert.equal(brick.verdict, 0, brick.out);
    assert.match(apps.out, /^android-artifacts=skipped$/m);
    assert.match(brick.out, /^app-brick=skipped$/m);
    assert.equal(gate({ 'lane-workers': 'success', 'lane-apps': apps.result, 'lane-brick': brick.result }), 'green');
  });

  test('an app PR: both lanes are affected and every app job runs; ci-gate green only when they ran green', () => {
    const changed = ['apps/subscriptiontracker/lib/main.dart'];
    const apps = laneResult('apps', changed, asGitHubRuns);
    const brick = laneResult('brick', changed, asGitHubRuns);
    assert.equal(apps.affected, true, apps.out);
    assert.equal(brick.affected, true, brick.out);
    for (const j of verdictNeeds('apps')) assert.match(apps.out, new RegExp(`^${j}=success$`, 'm'));
    assert.match(brick.out, /^app-brick=success$/m);
    assert.equal(gate({ 'lane-workers': 'success', 'lane-apps': apps.result, 'lane-brick': brick.result }), 'green');
  });

  test('RED CONTROL — an app PR whose app jobs were skipped anyway is red at the verdict, and so at ci-gate', () => {
    const changed = ['apps/subscriptiontracker/lib/main.dart'];
    const apps = laneResult('apps', changed, () => 'skipped');
    assert.equal(apps.affected, true);
    assert.equal(apps.verdict, 1, apps.out);
    assert.match(apps.out, /"android-artifacts" was SKIPPED although "detect" said affected=true/);
    assert.equal(gate({ 'lane-workers': 'success', 'lane-apps': apps.result, 'lane-brick': 'success' }), 'red');
  });

  test('RED CONTROL — a lane call that never ran (skipped) or was cancelled is red at ci-gate, never "not needed"', () => {
    assert.equal(gate({ 'lane-workers': 'success', 'lane-apps': 'skipped', 'lane-brick': 'success' }), 'red');
    assert.equal(gate({ 'lane-workers': 'success', 'lane-apps': 'success', 'lane-brick': 'cancelled' }), 'red');
  });

  test('a push to main narrows nothing: both lanes are affected whatever changed', () => {
    for (const lane of ['apps', 'brick']) {
      const d = decide({ map: MAP_REAL, lane, event: 'push', changed: null, diffWhy: null });
      assert.equal(d.affected, true, `${lane}: ${d.reason}`);
    }
  });

  test('a tooling-only PR outside what the app jobs read skips lane-apps; a docs-only PR skips both', () => {
    assert.equal(decide({ map: MAP_REAL, lane: 'apps', event: 'pull_request', changed: ['tooling/ci/assert-pr-rows.mjs'] }).affected, false);
    for (const lane of ['apps', 'brick']) {
      assert.equal(decide({ map: MAP_REAL, lane, event: 'pull_request', changed: ['docs/ci/README.md'] }).affected, false, lane);
    }
  });
});
