// ─────────────────────────────────────────────────────────────────────────────
// preflight-smoke.test.mjs — `preflight.mjs --smoke`, the pre-push leg: it judges
// the PUSHED COMMIT, takes no machine lock, runs inside a budget, and ends with a
// NOT CI-GATE line generated from ci.yml's own `ci-gate` needs.
//
// 🔴 THE DEFECT THIS PINS (O-PRE-PUSH-RUNS-NO-CI-GATE-LEG, 2026-09-24). The
// pre-push hook ran the spec guards and nothing that ci-gate needs, so a guard
// the pushed commit turned red was first seen in CI. The full preflight is too
// slow and too heavy for every push, and it closed with "CI should agree", a
// sentence no leg of it could make true: it runs none of the builds or uploads
// of the jobs ci-gate waits on.
//
// The need count is read through tooling/ci/workflow-scan.mjs, never typed, so the
// fixtures below use a ci.yml of each of the three `needs` forms that parse reads
// (flow, scalar, block), each with a count that is not the real ci.yml's.
//
// The end-to-end cases run the real preflight.mjs and guard-sweep.mjs in a REAL
// throwaway git repository — real commits, a real merge-base, real `git worktree
// add` — with a machine lock HELD by a live pid at a temp path. They never touch
// the machine's real %LOCALAPPDATA%\nikatru\heavy-run.lock.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { briefSweepOut, ciGateNeeds, notCiGateLine, smokeBudgetMs } from '../../scripts/preflight.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const TMP = mkdtempSync(join(tmpdir(), 'preflight-smoke-'));
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, 'utf8');
};
/** ⏱ 2026-09-26 (F-W17-1). guard-sweep.mjs refuses, exit 1, a CEILINGS key that names no
 *  file in tooling/ci (#945), and these fixtures copy the REAL guard-sweep.mjs into a tree
 *  holding none of the real guards. So each fixture gives every key the copy declares a
 *  stand-in with no entry point, which the sweep classifies LIBRARY: never run, never red.
 *  The keys are read from the copy under test, so a key added tomorrow is stood in tomorrow. */
const standInCeilings = (root) => {
  const src = readFileSync(join(root, 'tooling', 'scripts', 'guard-sweep.mjs'), 'utf8');
  const at = src.indexOf('const CEILINGS = {');
  if (at === -1) return;
  const table = src.slice(at, src.indexOf('\n};', at));
  for (const m of table.matchAll(/^\s*'([^']+\.mjs)':/gm)) {
    put(root, `tooling/ci/${m[1]}`, '// fixture stand-in: guard-sweep.mjs CEILINGS names this file (no entry point: a LIBRARY row)\nexport {};\n');
  }
};
// ⏱ 2026-09-26 (O-FLUTTER-BUILD-TYPED-PER-LINE): workflow-scan.mjs imports the release-build
// composer and the app set, and calls them only to compose a composer call, which no fixture
// here has. Each gets a stand-in with no entry point (a LIBRARY row) that throws if called; a
// copy of the real module is runnable, and the sweep would list it as UNREACHED.
const standInComposer = (root) => {
  put(root, 'tooling/ci/flutter-release-build.mjs', "// fixture stand-in: workflow-scan.mjs imports these names (no entry point: a LIBRARY row)\nconst refuse = () => { throw new Error('fixture stand-in: this fixture has no composer call'); };\nexport const composeReleaseBuild = refuse;\nexport const printed = refuse;\nexport const substitute = refuse;\n");
  put(root, 'tooling/ci/app-set.mjs', "// fixture stand-in: workflow-scan.mjs imports this name (no entry point: a LIBRARY row)\nexport const workspaceApps = () => { throw new Error('fixture stand-in: this fixture has no composer call'); };\n");
};

/** tooling/scripts/backup-headroom.mjs in a fixture repository: the real one
 *  reads this machine's backup sets, which a throwaway repository does not have.
 *  It prints the real module's summary shape, a ⬜ line, and exits
 *  $FIXTURE_HEADROOM_EXIT (default 0). */
const HEADROOM_STUB = [
  'const code = Number(process.env.FIXTURE_HEADROOM_EXIT || 0);',
  "console.log(`backup-headroom: 1 of 2 bounded set(s) graded, 0 warn, ${code ? 1 : 0} refuse, 0 research intruder(s)`);",
  "console.log(code ? '✗ REFUSE fixture set  10/10 (100%)' : '  ok   fixture set  1/10 (10%)');",
  "console.log(\"⬜ not walked: 'outside set' (Max 5)\");",
  'process.exit(code);',
  '',
].join('\n');

/** A directory holding only `.github/workflows/ci.yml` with this text. */
const ciTree = (name, lines) => {
  const root = join(TMP, name);
  put(root, '.github/workflows/ci.yml', lines.join('\n') + '\n');
  return root;
};

describe('ciGateNeeds — ci-gate\'s needs through workflow-scan\'s parse, every YAML form', () => {
  test('the FLOW form, a quoted entry included', () => {
    const root = ciTree('flow', [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-24.04',
      '  ci-gate:',
      '    needs: [build, "lint", test]',
      '    runs-on: ubuntu-24.04',
    ]);
    assert.deepEqual(ciGateNeeds(root), { needs: ['build', 'lint', 'test'] });
  });

  test('the SCALAR form', () => {
    const root = ciTree('scalar', [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-24.04',
      '  ci-gate:',
      '    needs: build',
      '    runs-on: ubuntu-24.04',
    ]);
    assert.deepEqual(ciGateNeeds(root), { needs: ['build'] });
  });

  test('the BLOCK form, a quoted entry included', () => {
    const root = ciTree('block', [
      'jobs:',
      '  ci-gate:',
      '    runs-on: ubuntu-24.04',
      '    needs:',
      '      - build',
      "      - 'lint'",
      '      - test',
      '      - deploy-check',
      '    if: always()',
    ]);
    assert.deepEqual(ciGateNeeds(root), { needs: ['build', 'lint', 'test', 'deploy-check'] });
  });

  test('no ci.yml is an error, never an empty list', () => {
    const root = join(TMP, 'no-ci');
    mkdirSync(root, { recursive: true });
    assert.match(ciGateNeeds(root).error, /ci\.yml does not exist/);
  });

  test('a ci.yml with no ci-gate job is an error', () => {
    const root = ciTree('no-gate', ['jobs:', '  build:', '    runs-on: ubuntu-24.04']);
    assert.match(ciGateNeeds(root).error, /has no `ci-gate` job/);
  });

  test('a ci-gate with no needs is an error, never zero covered of zero', () => {
    const root = ciTree('no-needs', ['jobs:', '  ci-gate:', '    runs-on: ubuntu-24.04']);
    assert.match(ciGateNeeds(root).error, /parses to ZERO needs/);
  });

  test('the real ci.yml: every need is a job the same file declares', () => {
    const { needs, error } = ciGateNeeds(REPO);
    assert.equal(error, undefined);
    assert.ok(needs.length >= 5, `ci-gate reads as needing only ${needs.length} job(s)`);
    const text = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    const missing = needs.filter((n) => !new RegExp(`^  ${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`, 'm').test(text));
    assert.deepEqual(missing, []);
  });
});

/** A guard-sweep --json row, as the sweep writes it. */
const row = (name, verdict, jobs) => ({ name, verdict, red: verdict.startsWith('RED'), jobs: jobs.map((job) => ({ wf: 'ci.yml', job })) });

describe('notCiGateLine — what this run did not cover, generated', () => {
  const doc = {
    rows: [
      row('a.mjs', 'ok', ['guards']),
      row('b.mjs', 'RED(1)', ['guards', 'late']),
      row('c.mjs', 'BUDGET', ['late']),
      row('d.mjs', 'NEEDS-CI', ['secret']),
      row('e.mjs', 'ok', ['other-workflow-job']),
    ],
  };

  test('the counts come from the needs and the rows, and every unreached need is named', () => {
    const line = notCiGateLine({ needs: ['guards', 'late', 'secret', 'build'], doc });
    assert.match(line, /^⬜ NOT CI-GATE — ci-gate needs 4 job\(s\) in \.github\/workflows\/ci\.yml\. /);
    assert.match(line, /This run ran 2 of the 4 tooling\/ci guard\(s\) they invoke \(not run: 1 BUDGET · 1 NEEDS-CI\) and reached 2 of the 4\./);
    assert.match(line, /No guard ran for: secret, build\. Only tooling\/ci guards ran here;/);
  });

  test('🔴 a need whose only guard the budget cut is NOT reached', () => {
    const line = notCiGateLine({ needs: ['late'], doc: { rows: [row('c.mjs', 'BUDGET', ['late'])] } });
    assert.match(line, /ran 0 of the 1 tooling\/ci guard\(s\) they invoke \(not run: 1 BUDGET\) and reached 0 of the 1\. No guard ran for: late\./);
  });

  test('no sweep document: nothing is counted as reached', () => {
    const line = notCiGateLine({ needs: ['guards', 'build'], doc: null });
    assert.match(line, /ci-gate needs 2 job\(s\).*ran 0 of the 0 .*not run: none.*reached 0 of the 2\. No guard ran for: guards, build\./);
  });

  test('a full run names how many other legs it ran besides the guards', () => {
    const line = notCiGateLine({ needs: ['guards'], doc, besides: ['guard suites', 'format drift'] });
    assert.match(line, /Besides guards this run ran 2 other leg\(s\); every build, upload and runner-only step of those jobs is CI's alone\.$/);
  });
});

// ── the full run's verdict, end to end ───────────────────────────────────────
// A reading of the source cannot tell whether the verdict RUNS: the first version
// of this change declared the sweep document inside the `try` that holds the
// legs, and the verdict outside it threw a ReferenceError after six green legs.
// So the verdict is exercised here, in a repository where every --fast leg can
// be green.
describe('the full run closes with the generated line, not "CI should agree."', () => {
  let root;
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=smoke-test', '-c', 'user.email=smoke-test@example.invalid', ...args], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  before(() => {
    root = mkdtempSync(join(TMP, 'full-'));
    for (const rel of ['tooling/scripts/preflight.mjs', 'tooling/scripts/heavy-lock.mjs', 'tooling/scripts/guard-sweep.mjs', 'tooling/ci/workflow-scan.mjs', 'tooling/ci/tree-walk.mjs']) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      copyFileSync(join(REPO, rel), join(root, rel));
    }
    standInCeilings(root);
    standInComposer(root);
    put(root, 'tooling/ci/assert-guard-coverage.mjs', "const NOT_CI_RUNNABLE = new Map([\n  ['z-exempt.mjs',\n    'fixture'],\n]);\nexport default NOT_CI_RUNNABLE;\n");
    put(root, 'tooling/ci/a-guard.mjs', "console.log('ok a'); process.exit(0);\n");
    put(root, 'tooling/ci/assert-sworn-store-files.mjs', "console.log('ok sworn'); process.exit(0);\n");
    put(root, 'tooling/scripts/backup-headroom.mjs', HEADROOM_STUB);
    put(root, 'tooling/ci/test/fixture.test.mjs', "import { test } from 'node:test';\ntest('fixture', () => {});\n");
    // The format leg refuses a tree with no tracked Dart file at all.
    put(root, 'lib/fixture.dart', 'void main() {}\n');
    put(root, '.github/workflows/ci.yml', [
      'name: ci',
      'on: [push]',
      'jobs:',
      '  guards:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: node tooling/ci/a-guard.mjs',
      '      - run: node tooling/ci/assert-sworn-store-files.mjs',
      '  build:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: echo build',
      '  ci-gate:',
      '    needs: [guards, build]',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: echo gate',
      '',
    ].join('\n'));
    git('init', '-q', '-b', 'main');
    put(root, '.gitattributes', '* text=auto eol=lf\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
  });

  test('🔴 --fast, all legs green: exit 0, and the last line is the NOT CI-GATE line for this ci.yml', () => {
    const env = { ...process.env, NIKATRU_HEAVY_LOCK: join(TMP, 'full-lock', 'heavy-run.lock'), NIKATRU_HEAVY_BACKUP_TASK: '', NIKATRU_HEAVY_LOCK_POLL_MS: '100', CI: '' };
    delete env.NIKATRU_HEAVY_LOCK_TOKEN;
    const r = spawnSync(process.execPath, [join(root, 'tooling', 'scripts', 'preflight.mjs'), '--fast', '--base', 'main', '--lock-wait', '0.05'], {
      cwd: root, env, encoding: 'utf8', timeout: 300_000,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 0, out.slice(-3000));
    assert.match(out, /preflight: ok — 7 leg\(s\) green \(--fast: stamped-app leg skipped\)\.\n/);
    // The backup-headroom leg (2026-09-26) ran, green, and its ⬜ line printed its output.
    assert.match(out, /ok {3}backup headroom \(the backup's own sets and bounds\)\n {5}backup-headroom: 1 of 2 bounded set\(s\) graded/);
    assert.doesNotMatch(out, /CI should agree/);
    const last = out.trimEnd().split(/\r?\n/).pop();
    assert.match(last, /^⬜ NOT CI-GATE — ci-gate needs 2 job\(s\) in \.github\/workflows\/ci\.yml\. This run ran 2 of the 2 tooling\/ci guard\(s\) they invoke \(not run: none\) and reached 1 of the 2\. No guard ran for: build\. Besides guards this run ran 5 other leg\(s\);/);
  });
});

describe('briefSweepOut — what a push prints of the sweep', () => {
  const sweepOut = [
    'ok  a-guard.mjs        ok        args: x  (12 ms)',
    '⬜  lib.mjs            LIBRARY   no process.exit/argv — imported, not executed',
    '⬜  late.mjs           BUDGET    not started — the --budget-ms 1 ceiling was spent before its turn; NOT run, NOT judged',
    '⬜  orphan.mjs         UNREACHED 🔴 runnable, invoked by NO workflow, reached by no import, and carrying no recorded exemption',
    '✗   red.mjs            RED(1)    no invocation passes here (1 tried, last: (no args))  (40 ms)',
    '      ↳ ✗ red finding',
    '',
    '⬜ guard sweep — 5 file(s) in tooling/ci, 2 executed with the arguments 1 workflow(s) really pass them: 1 ok · 1 RED',
    '   This asserts COMPLETENESS, not greenness.',
    '⬜ --budget-ms 1: 1 guard(s) that would have run were NOT started (BUDGET above); the guards that did run took 52 ms.',
    '⏱ --times: 2 guard(s) executed in 52 ms · median 12 ms · p90 40 ms · slowest: red.mjs 40 ms',
    '✗ 1 runnable file(s) in tooling/ci are invoked by no workflow — the sweep cannot reach them and neither can CI.',
  ].join('\n');

  test('keeps the reds, their reason, an UNREACHED row and the summaries', () => {
    const lines = sweepOut.split('\n');
    // UNREACHED row, RED row, its ↳ reason, the sweep / budget / times summaries, the exit-1 line.
    assert.deepEqual(briefSweepOut(sweepOut).trimEnd().split('\n'), [lines[3], lines[4], lines[5], lines[7], lines[9], lines[10], lines[11]]);
  });

  test('drops the ok, LIBRARY and BUDGET rows (the NOT CI-GATE line counts the cut ones)', () => {
    const kept = briefSweepOut(sweepOut);
    assert.doesNotMatch(kept, /a-guard\.mjs|lib\.mjs|late\.mjs/);
  });
});

describe('smokeBudgetMs — NIKATRU_SMOKE_BUDGET_S, default 60', () => {
  test('unset or empty is the 60 s default', () => {
    assert.deepEqual(smokeBudgetMs({}), { ms: 60_000 });
    assert.deepEqual(smokeBudgetMs({ NIKATRU_SMOKE_BUDGET_S: '' }), { ms: 60_000 });
  });
  test('a number of seconds, fractions included', () => {
    assert.deepEqual(smokeBudgetMs({ NIKATRU_SMOKE_BUDGET_S: '1.5' }), { ms: 1500 });
  });
  test('a value that is set and unusable refuses, never falls back', () => {
    assert.match(smokeBudgetMs({ NIKATRU_SMOKE_BUDGET_S: 'soon' }).error, /is not a positive number of seconds/);
    assert.match(smokeBudgetMs({ NIKATRU_SMOKE_BUDGET_S: '0' }).error, /is not a positive number of seconds/);
    assert.match(smokeBudgetMs({ NIKATRU_SMOKE_BUDGET_S: '-5' }).error, /is not a positive number of seconds/);
  });
});

// ── end to end, in a real repository ─────────────────────────────────────────
describe('preflight --smoke end to end — the pushed commit, no lock, a budget, the line', () => {
  let root;
  let lock;
  let heldRecord;
  const shas = {};
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=smoke-test', '-c', 'user.email=smoke-test@example.invalid', ...args], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const smoke = (args, extraEnv = {}) => {
    const env = { ...process.env, NIKATRU_HEAVY_LOCK: lock, NIKATRU_HEAVY_BACKUP_TASK: '', NIKATRU_HEAVY_LOCK_POLL_MS: '100', CI: '', ...extraEnv };
    delete env.NIKATRU_HEAVY_LOCK_TOKEN;
    if (!('NIKATRU_SMOKE_BUDGET_S' in extraEnv)) delete env.NIKATRU_SMOKE_BUDGET_S;
    // --lock-wait is ignored by --smoke; it is here so that a smoke which DID take
    // the lock would give up in about a second instead of 90 minutes.
    const r = spawnSync(process.execPath, [join(root, 'tooling', 'scripts', 'preflight.mjs'), '--smoke', '--base', 'main', '--lock-wait', '0.02', ...args], {
      cwd: root, env, encoding: 'utf8', timeout: 120_000,
    });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const worktrees = () => git('worktree', 'list', '--porcelain').split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length;

  before(() => {
    root = mkdtempSync(join(TMP, 'repo-'));
    for (const rel of ['tooling/scripts/preflight.mjs', 'tooling/scripts/heavy-lock.mjs', 'tooling/scripts/guard-sweep.mjs', 'tooling/ci/workflow-scan.mjs', 'tooling/ci/tree-walk.mjs']) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      copyFileSync(join(REPO, rel), join(root, rel));
    }
    standInCeilings(root);
    standInComposer(root);
    put(root, 'tooling/ci/assert-guard-coverage.mjs', "const NOT_CI_RUNNABLE = new Map([\n  ['z-exempt.mjs',\n    'fixture'],\n]);\nexport default NOT_CI_RUNNABLE;\n");
    put(root, 'tooling/ci/a-subject-guard.mjs',
      "import { readFileSync } from 'node:fs';\n" +
      "const s = readFileSync(new URL('../../subject.txt', import.meta.url), 'utf8');\n" +
      "if (s.includes('BAD')) { console.log('✗ subject.txt carries BAD'); process.exit(1); }\n" +
      "console.log('ok subject'); process.exit(0);\n");
    put(root, 'tooling/ci/ci-only.mjs', "console.log('ci only'); process.exit(0);\n");
    put(root, 'tooling/ci/m-slow-guard.mjs', "setTimeout(() => { console.log('slow ok'); process.exit(0); }, 1500);\n");
    put(root, 'tooling/ci/z-late-guard.mjs', "console.log('late ok'); process.exit(0);\n");
    put(root, 'tooling/scripts/backup-headroom.mjs', HEADROOM_STUB);
    const ciYml = (gate) => [
      'name: ci',
      'on: [push]',
      'jobs:',
      '  guards:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: node tooling/ci/a-subject-guard.mjs',
      '      - run: node tooling/ci/m-slow-guard.mjs',
      '  late:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: node tooling/ci/z-late-guard.mjs',
      '  secret:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: node tooling/ci/ci-only.mjs ${{ secrets.TOKEN }}',
      '  build:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: echo build',
      ...gate,
      '',
    ].join('\n');
    const gateJob = ['  ci-gate:', '    runs-on: ubuntu-24.04', '    needs:', '      - guards', '      - late', '      - secret', '      - build', '    if: always()', '    steps:', '      - run: echo gate'];
    put(root, '.github/workflows/ci.yml', ciYml(gateJob));
    put(root, 'subject.txt', 'good\n');
    git('init', '-q', '-b', 'main');
    put(root, '.gitattributes', '* text=auto eol=lf\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    shas.main = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'feature');
    put(root, 'subject.txt', 'BAD\n');
    git('commit', '-q', '-am', 'the branch breaks the subject');
    shas.feature = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'no-gate', 'main');
    put(root, '.github/workflows/ci.yml', ciYml([]));
    git('commit', '-q', '-am', 'no ci-gate job');
    shas.noGate = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    // The WORKING TREE is broken and uncommitted: the smoke must not see it.
    put(root, 'subject.txt', 'BAD\n');

    lock = join(TMP, 'held', 'heavy-run.lock');
    heldRecord = JSON.stringify({ pid: process.pid, argv: ['held-by-preflight-smoke-test'], startedAt: new Date().toISOString(), host: 'test', token: 'held-token' });
    put(TMP, 'held/heavy-run.lock', heldRecord);
  });

  test('🔴 green on the committed HEAD while the working tree is red, with the machine lock HELD by another pid', () => {
    const t0 = Date.now();
    const r = smoke([]);
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, new RegExp(`preflight --smoke ${shas.main.slice(0, 8)}: ok — 3 of 3 runnable guard\\(s\\) ran in [0-9.]+ s \\(budget 60 s, 0 cut\\), 0 red`));
    assert.doesNotMatch(r.out, /heavy-run lock|COVERAGE LOST/);
    assert.equal(readFileSync(lock, 'utf8'), heldRecord, 'the smoke touched the held machine lock');
    assert.ok(elapsed < 60_000, `the smoke took ${elapsed} ms`);
    assert.equal(worktrees(), 1, 'the smoke left its checkout registered');
  });

  test('🔴 the last line is the NOT CI-GATE line, generated from the fixture ci.yml\'s four needs', () => {
    const r = smoke([]);
    const last = r.out.trimEnd().split(/\r?\n/).pop();
    assert.match(last, /^⬜ NOT CI-GATE — ci-gate needs 4 job\(s\) in \.github\/workflows\/ci\.yml\. This run ran 3 of the 4 tooling\/ci guard\(s\) they invoke \(not run: 1 NEEDS-CI\) and reached 2 of the 4\. No guard ran for: secret, build\./);
  });

  test('🔴 the backup headroom prints first, is not a counted guard, and a red one refuses the push', () => {
    const green = smoke([]);
    assert.equal(green.status, 0, green.out);
    assert.match(green.out, /^backup-headroom: 1 of 2 bounded set\(s\) graded, 0 warn, 0 refuse/);
    assert.match(green.out, /^⬜ not walked: 'outside set' \(Max 5\)$/m);
    assert.doesNotMatch(green.out, /ok {3}fixture set/, 'a green push prints only the summary and the ⬜ lines');
    const red = smoke([], { FIXTURE_HEADROOM_EXIT: '1' });
    assert.equal(red.status, 1, red.out);
    assert.match(red.out, /^✗ REFUSE fixture set {2}10\/10 \(100%\)$/m);
    // 3 of 3: the headroom leg is this machine's state, not one of the runnable guards.
    assert.match(red.out, new RegExp(`preflight --smoke ${shas.main.slice(0, 8)}: ok — 3 of 3 runnable guard\\(s\\) ran`));
    assert.match(red.out.trimEnd().split(/\r?\n/).pop(), /^preflight --smoke: FAIL — backup headroom \(the backup's own sets and bounds\) exited 1 \(above\)\./);
  });

  test('🔴 a red the pushed commit caused FAILS the smoke, judged against the merge-base', () => {
    const r = smoke(['--sha', 'feature']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /✗ REGRESSION\s+a-subject-guard\.mjs .*subject\.txt carries BAD/);
    assert.match(r.out, new RegExp(`preflight --smoke ${shas.feature.slice(0, 8)}: FAIL — `));
    assert.equal(worktrees(), 1, 'a checkout was left registered');
  });

  test('🔴 the budget cuts the guards due after it, and the line counts them as not run', () => {
    const r = smoke([], { NIKATRU_SMOKE_BUDGET_S: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /2 of 3 runnable guard\(s\) ran in [0-9.]+ s \(budget 1 s, 1 cut\)/);
    assert.match(r.out, /not run: 1 BUDGET · 1 NEEDS-CI\) and reached 1 of the 4\. No guard ran for: late, secret, build\./);
  });

  test('🔴 a commit whose ci.yml has no ci-gate is COVERAGE LOST (exit 2), and no guard runs', () => {
    const r = smoke(['--sha', 'no-gate']);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — \.github\/workflows\/ci\.yml has no `ci-gate` job at [0-9a-f]{8}, so this smoke cannot say what it did not cover\. No guard was run\./);
    assert.doesNotMatch(r.out, /guard sweep —/);
    assert.equal(worktrees(), 1);
  });

  test('a rev that names no commit is COVERAGE LOST (exit 2)', () => {
    const r = smoke(['--sha', 'no-such-branch']);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — `no-such-branch` names no commit here/);
  });

  test('--sha with no value is a usage error (exit 2), not a smoke of HEAD', () => {
    const r = smoke(['--sha']);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /--sha needs a commit after it/);
  });

  test('an unusable NIKATRU_SMOKE_BUDGET_S refuses (exit 2) before anything runs', () => {
    const r = smoke([], { NIKATRU_SMOKE_BUDGET_S: 'soon' });
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /NIKATRU_SMOKE_BUDGET_S=`soon` is not a positive number of seconds/);
    assert.equal(worktrees(), 1);
  });
});
