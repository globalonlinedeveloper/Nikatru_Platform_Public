// affected-guards.test.mjs — tooling/scripts/affected-guards.mjs, the pre-push run of
// the checks that cover what a push changed (lane fix-prepush-affected-guards).
//
// Each case builds a throwaway repository with a ci.yml that calls two guards and a
// test glob, a lane-map.json, and data the guards read, then drives `main()` against
// it. Every refusal has its green control first, in the same fixture:
//   AG1  a change to a guarded file selects that guard, and not its neighbour
//   AG2  a path no subject names and lane-map does not declare ungraded is exit 2
//   AG3  a selected check that fails refuses (exit 1), judged against the base
//   AG4  the escape hatch skips only a selected check, needs a reason, and logs
//   AG5  --sha must be the checked-out HEAD
//   AG6  the REAL .githooks/pre-push refuses the push when the affected run fails
//   AG7  the workflow read: node flags that take a value, and --test reporters dropped
//   AG8  a small top-level directory a test reads in a loop selects that test (the first
//        CI run of this tool missed hook-runner-pin.test.mjs exactly so)
//   AG9  a guard whose subject is a SHAPE OF TEXT is selected by the changed file's text,
//        with the guard's own detector (#1076 cycle 3: tooling/ops/land-rules.mjs began
//        to read ci.yml and assert-workflow-readers was not run; a prose edit ran no
//        assert-mechanism-claims)
//
// Run:  node --test "tooling/ci/test/affected-guards.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, parseNodeCall, scanSource, withCiEnv } from '../../scripts/affected-guards.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const git = (root, ...args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
};

const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

const GUARD = (dir, file) => [
  "import { readFileSync } from 'node:fs';",
  "import { dirname, join, resolve } from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  "const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');",
  `const text = readFileSync(join(ROOT, '${dir}', '${file}'), 'utf8');`,
  "if (text.includes('bad')) { console.log('FAIL the data says bad'); process.exit(1); }",
  "console.log('ok'); process.exit(0);",
  '',
].join('\n');

/** A committed repository on `main` with two guards, one test and a lane map. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'affected-guards-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'commit.gpgsign', 'false');
  put(root, '.github/workflows/ci.yml', [
    'name: CI',
    'on: pull_request',
    'jobs:',
    '  guards:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - name: the x data is good',
    '        run: node tooling/ci/assert-x.mjs',
    '      - name: the y data is good',
    '        run: node tooling/ci/assert-y.mjs',
    '      - name: the guard tests',
    '        run: node --test-timeout=60000 --test "tooling/ci/test/*.test.mjs"',
    '',
  ].join('\n'));
  put(root, 'tooling/ci/assert-x.mjs', GUARD('data', 'x.json'));
  put(root, 'tooling/ci/assert-y.mjs', GUARD('other', 'y.json'));
  put(root, 'tooling/ci/test/x.test.mjs', [
    "import { test } from 'node:test';",
    "// runs tooling/ci/assert-x.mjs",
    "const GUARD = 'tooling/ci/assert-x.mjs';",
    "test('x', () => {});",
    '',
  ].join('\n'));
  // a test that reads a small top-level directory in a loop, as hook-runner-pin reads .githooks
  put(root, 'tooling/ci/test/hooks.test.mjs', [
    "import { test } from 'node:test';",
    "import { join } from 'node:path';",
    "const REPO = process.cwd();",
    "test('hooks', () => { for (const h of ['pre-push']) join(REPO, 'hooks', h); });",
    '',
  ].join('\n'));
  put(root, 'hooks/pre-push', '#!/bin/sh\nexit 0\n');
  put(root, 'tooling/ci/lane-map.json', JSON.stringify({
    lanes: { guards: { globs: ['tooling/**', '.github/**', 'data/**', 'other/**', 'misc/**', 'hooks/**'] } },
    unclaimed: ['docs/**'],
  }, null, 2));
  put(root, 'data/x.json', '{"x": "good"}\n');
  put(root, 'other/y.json', '{"y": "good"}\n');
  put(root, 'misc/z.txt', 'nothing reads this\n');
  put(root, 'docs/a.md', '# prose\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return root;
}

async function run(root, argv) {
  const lines = [];
  const code = await main(argv, { root, log: (l) => lines.push(l), err: (l) => lines.push(l) });
  return { code, out: lines.join('\n') };
}

const selectedIds = (out) => [...out.matchAll(/tier \d+ {2}(\S+)/g)].map((m) => m[1]);

test('AG1 a change to a guarded file selects that guard — and a neighbour\'s file does not', async () => {
  const root = fixture();
  try {
    const x = await run(root, ['--list', '--paths', 'data/x.json']);
    assert.equal(x.code, 0, x.out);
    assert.deepEqual(selectedIds(x.out), ['guard:assert-x'], `data/x.json names assert-x only: ${x.out}`);
    // RED control: the other guard's data selects the other guard, never assert-x
    const y = await run(root, ['--list', '--paths', 'other/y.json']);
    assert.deepEqual(selectedIds(y.out), ['guard:assert-y'], y.out);
    // a change to the guard's CODE selects the guard and the test that runs it
    const code = await run(root, ['--list', '--paths', 'tooling/ci/assert-x.mjs']);
    assert.deepEqual(selectedIds(code.out).sort(), ['guard:assert-x', 'test:x'], code.out);
    assert.match(code.out, /coverage 1\/1 changed paths mapped \(100%\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AG2 an unmapped path is COVERAGE LOST, exit 2 — a path lane-map declares ungraded is not', async () => {
  const root = fixture();
  try {
    const declared = await run(root, ['--list', '--paths', 'docs/a.md']);
    assert.equal(declared.code, 0, `green control: docs/** is lane-map's \`unclaimed\`: ${declared.out}`);
    assert.match(declared.out, /1 declared ungraded/);
    const lost = await run(root, ['--list', '--paths', 'misc/z.txt']);
    assert.equal(lost.code, 2, lost.out);
    assert.match(lost.out, /UNMAPPED {2}misc\/z\.txt/);
    assert.match(lost.out, /coverage 0\/1 changed paths mapped \(0%\)/);
    // one unmapped path among mapped ones still refuses: coverage is per path, not per run
    const mixed = await run(root, ['--list', '--paths', 'data/x.json', 'misc/z.txt']);
    assert.equal(mixed.code, 2, mixed.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AG3 a failing selected check refuses (exit 1): red here, green at the base', async () => {
  const root = fixture();
  try {
    const green = await run(root, ['--paths', 'data/x.json', '--base', 'main', '--jobs', '2']);
    assert.equal(green.code, 0, `green control first: ${green.out}`);
    assert.match(green.out, /✓ +0 +\S+ +guard:assert-x/);
    put(root, 'data/x.json', '{"x": "bad"}\n');
    const red = await run(root, ['--paths', 'data/x.json', '--base', 'main', '--jobs', '2']);
    assert.equal(red.code, 1, red.out);
    assert.match(red.out, /✗ +1 +\S+ +guard:assert-x/, 'one line per check with its exit code');
    assert.match(red.out, /✗ FINDING +guard:assert-x — green at the base, red here/);
    assert.match(red.out, /FAIL the data says bad/, 'the finding carries the check\'s own output');
    assert.match(red.out, /total \d+\.\ds/, 'the wall time is printed');
    assert.equal(existsSync(join(root, '.worktrees')) && spawnSync('git', ['worktree', 'list'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean).length > 1, false,
      'the base checkout is removed after the re-run');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AG4 the escape hatch skips only a selected check, by name, with a reason, and logs it', async () => {
  const root = fixture();
  try {
    put(root, 'data/x.json', '{"x": "bad"}\n');
    const noReason = await run(root, ['--paths', 'data/x.json', '--skip-for-ci', 'guard:assert-x']);
    assert.equal(noReason.code, 2, `a skip without a reason is refused: ${noReason.out}`);
    const notSelected = await run(root, ['--paths', 'data/x.json', '--skip-for-ci', 'guard:assert-y', '--reason', 'linux only']);
    assert.equal(notSelected.code, 2, `a skip that names an unselected check is refused: ${notSelected.out}`);
    assert.match(notSelected.out, /did not select/);
    const skipped = await run(root, ['--paths', 'data/x.json', '--skip-for-ci', 'guard:assert-x', '--reason', 'goldens render on Linux only']);
    assert.equal(skipped.code, 0, skipped.out);
    assert.match(skipped.out, /SKIPPED-FOR-CI {2}guard:assert-x {2}— goldens render on Linux only/);
    const log = readFileSync(join(root, '.git', 'affected-guards-skips.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(log.length, 1);
    assert.deepEqual(log[0].skipped, ['guard:assert-x']);
    assert.equal(log[0].reason, 'goldens render on Linux only');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AG5 --sha must be the checked-out HEAD: the checks read this tree, not that commit', async () => {
  const root = fixture();
  try {
    const first = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-q', '-b', 'lane');
    put(root, 'data/x.json', '{"x": "still good"}\n');
    git(root, 'commit', '-q', '-am', 'lane change');
    const head = git(root, 'rev-parse', 'HEAD');
    const ok = await run(root, ['--sha', head, '--base', 'main', '--jobs', '2']);
    assert.equal(ok.code, 0, `green control: HEAD itself: ${ok.out}`);
    assert.match(ok.out, /1 changed path\(s\) vs merge-base/);
    const other = await run(root, ['--sha', first, '--base', 'main']);
    assert.equal(other.code, 2, other.out);
    assert.match(other.out, /is not HEAD/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** The real pre-push hook with stub runners; `affectedExit` is what the stub
 *  affected-guards.mjs exits with, and it records the argv it was given. */
function hookSandbox(affectedExit) {
  const root = mkdtempSync(join(tmpdir(), 'affected-hook-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, '.githooks'));
  copyFileSync(join(REPO, '.githooks', 'pre-push'), join(root, '.githooks', 'pre-push'));
  put(root, 'tooling/scripts/spec-guards.mjs', 'process.exit(0);\n');
  put(root, 'tooling/scripts/preflight.mjs', "console.log('stub smoke'); process.exit(0);\n");
  put(root, 'tooling/scripts/affected-guards.mjs', [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.ARGV_OUT, JSON.stringify(process.argv.slice(2)));",
    "if (Number(process.env.AFFECTED_EXIT) === 1) console.log('✗ FINDING       guard:assert-x — green at the base, red here');",
    'process.exit(Number(process.env.AFFECTED_EXIT));',
    '',
  ].join('\n'));
  put(root, 'a.txt', 'a\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'one');
  const sha = git(root, 'rev-parse', 'HEAD');
  const argvOut = join(root, 'argv.json');
  const r = spawnSync('sh', ['.githooks/pre-push'], {
    cwd: root,
    encoding: 'utf8',
    input: `refs/heads/lane ${sha} refs/heads/lane ${'0'.repeat(40)}\n`,
    env: { ...process.env, AFFECTED_EXIT: String(affectedExit), ARGV_OUT: argvOut },
  });
  const argv = existsSync(argvOut) ? JSON.parse(readFileSync(argvOut, 'utf8')) : null;
  return { root, sha, code: r.status, out: `${r.stdout}${r.stderr}`, argv };
}

test('AG6 the real pre-push refuses the push when the affected run fails, and passes when it is green', () => {
  const green = hookSandbox(0);
  try {
    assert.equal(green.code, 0, `green control first: ${green.out}`);
    assert.match(green.out, /stub smoke/, 'a green affected run continues to the ci-gate smoke');
    assert.deepEqual(green.argv.slice(-2), ['--sha', green.sha], `the hook judges the pushed commit: ${green.argv}`);
    assert.equal(green.argv[0], '--root');
  } finally { rmSync(green.root, { recursive: true, force: true }); }
  const red = hookSandbox(1);
  try {
    assert.equal(red.code, 1, red.out);
    assert.match(red.out, /pre-push: the affected checks of [0-9a-f]{40} are not clean \(exit 1\)\. Push refused\./);
    assert.doesNotMatch(red.out, /stub smoke/, 'a refused push runs nothing after the refusal');
    assert.deepEqual(red.out.split('\n').filter((l) => l.includes('--no-verify') && !/\bnever\b/i.test(l)), [], 'no bypass is printed as a way forward');
  } finally { rmSync(red.root, { recursive: true, force: true }); }
  const lost = hookSandbox(2);
  try {
    assert.equal(lost.code, 2, `COVERAGE LOST refuses the push too, and stays exit 2: ${lost.out}`);
  } finally { rmSync(lost.root, { recursive: true, force: true }); }
});

test('AG7 the workflow read: value-taking node flags, the script, and a --test call without its reporters', () => {
  assert.deepEqual(parseNodeCall('node --single-threaded tooling/ci/assert-x.mjs --app probe'),
    { flags: ['--single-threaded'], script: 'tooling/ci/assert-x.mjs', args: ['--app', 'probe'] });
  // --import takes the next word: the script is the guard, not spawn-ceiling.mjs
  assert.equal(parseNodeCall('node --import ./tooling/scripts/spawn-ceiling.mjs tooling/ci/assert-x.mjs').script, 'tooling/ci/assert-x.mjs');
  const t = parseNodeCall('node --import ./tooling/scripts/spawn-ceiling.mjs --test-timeout=600000 --test --test-reporter=spec  --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination="${{ runner.temp }}/guard-tests.junit.xml" "tooling/ci/test/*.test.mjs"');
  assert.deepEqual(t, { test: ['tooling/ci/test/*.test.mjs'], flags: ['--import', './tooling/scripts/spawn-ceiling.mjs', '--test-timeout=600000'] });
  assert.equal(parseNodeCall('echo node is not called here'), null);
  // The workflows' `--import "$SPAWN_CEILING"` replays as the checkout's own absolute
  // preload URL: no shell expands it here, and a relative path would follow the cwd.
  const w = parseNodeCall('node --import "$SPAWN_CEILING" --test-timeout=600000 --test scripts/test/a.test.mjs');
  assert.deepEqual(w.flags, ['--import', '$SPAWN_CEILING', '--test-timeout=600000']);
  const root = resolve('/somewhere', 'checkout');
  const url = pathToFileURL(join(root, 'tooling', 'scripts', 'spawn-ceiling.mjs')).href;
  assert.deepEqual(withCiEnv(w.flags, root), ['--import', url, '--test-timeout=600000']);
  assert.deepEqual(withCiEnv(['--import', '${SPAWN_CEILING}'], root), ['--import', url]);
  assert.deepEqual(withCiEnv(['--import', '$SPAWN_CEILING_MS', 'x$SPAWN_CEILING'], root), ['--import', '$SPAWN_CEILING_MS', 'x$SPAWN_CEILING'], 'only the whole word');
  // join chains: the base argument drops, a later non-literal is "any path"
  const { chains } = scanSource("const a = join(ROOT, 'apps', app, 'pubspec.yaml'); const b = join(HERE, '..', 'x.json');");
  assert.deepEqual(chains.map((c) => c.parts), [['apps', '\u0000', 'pubspec.yaml'], ['..', 'x.json']]);
});

test('AG10 a sharded guard-tests step (node --test $(cat <plan>)) still selects the guard suites; without its --plan call the parse is blind', async () => {
  const sharded = (plan) => [
    'name: CI',
    'on: pull_request',
    'jobs:',
    '  guard-tests:',
    '    runs-on: ubuntu-24.04',
    '    strategy:',
    '      matrix:',
    '        shard: [1, 2]',
    '    steps:',
    '      - name: the x data is good',
    '        run: node tooling/ci/assert-x.mjs',
    '      - name: The guards must be able to fail',
    '        run: |',
    ...(plan ? ['          node tooling/ci/guard-test-shards.mjs --plan --shards 2 --shard ${{ matrix.shard }} --out "${{ runner.temp }}/files.txt"'] : []),
    '          node --test-timeout=60000 --test $(cat "${{ runner.temp }}/files.txt")',
    '',
  ].join('\n');
  const root = fixture();
  try {
    put(root, '.github/workflows/ci.yml', sharded(true));
    const r = await run(root, ['--list', '--paths', 'tooling/ci/assert-x.mjs']);
    assert.deepEqual(selectedIds(r.out).sort(), ['guard:assert-x', 'test:x'], r.out);
    // RED control: the same step without the plan call is a `$(…)` nobody can read.
    // Here it is the only test call, so the parse is blind and says so; on the real
    // tree, where other test calls exist, the guard suites would silently drop out.
    put(root, '.github/workflows/ci.yml', sharded(false));
    const blind = await run(root, ['--list', '--paths', 'tooling/ci/assert-x.mjs']);
    assert.equal(blind.code, 2, blind.out);
    assert.match(blind.out, /no guard or no test call/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AG8 a two-file top-level directory a test reads in a loop selects the test; a wide one would not', async () => {
  const root = fixture();
  try {
    const r = await run(root, ['--list', '--paths', 'hooks/pre-push']);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(selectedIds(r.out), ['test:hooks'], `hooks/ holds one file, so naming it is specific: ${r.out}`);
    // RED control: the same directory grown past the breadth line is broad — it selects
    // nothing and maps nothing, so the path is UNMAPPED
    for (let i = 0; i < 60; i++) put(root, `hooks/extra-${i}.sh`, '#!/bin/sh\n');
    git(root, 'add', '-A');
    const wide = await run(root, ['--list', '--paths', 'hooks/pre-push']);
    assert.equal(wide.code, 2, wide.out);
    assert.deepEqual(selectedIds(wide.out), [], wide.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** The fixture plus the two REAL content-subject guards and their registers, wired into ci.yml. */
function contentFixture(mutate = (rel, text) => text) {
  const root = fixture();
  for (const rel of ['tooling/ci/assert-workflow-readers.mjs', 'tooling/ci/assert-mechanism-claims.mjs', 'tooling/workflow-readers.json', 'tooling/mechanism-claims.json']) {
    put(root, rel, mutate(rel, readFileSync(join(REPO, rel), 'utf8')));
  }
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8').replace(
    '      - name: the guard tests\n',
    '      - name: workflow readers\n        run: node tooling/ci/assert-workflow-readers.mjs\n' +
      '      - name: mechanism claims\n        run: node tooling/ci/assert-mechanism-claims.mjs\n' +
      '      - name: the guard tests\n',
  );
  put(root, '.github/workflows/ci.yml', ci);
  // Under misc/, which no guard of the fixture names as a place: only the text can select.
  put(root, 'misc/reads-ci.mjs', "import { readFileSync } from 'node:fs';\nconst ci = readFileSync('.github/workflows/ci.yml', 'utf8');\nconsole.log(ci.length);\n");
  put(root, 'misc/reads-nothing.mjs', "console.log('no workflow here');\n");
  // Joined at run time: written out whole, the claim shape would be a candidate site of THIS
  // file for assert-mechanism-claims, which sweeps every tracked text file.
  put(root, 'docs/claim.md', `# how it works\n\nThere is ${['no', 'second', 'list'].join(' ')} to keep in step.\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'content guards');
  return root;
}

test('AG9 a guard whose subject is a shape of TEXT is selected by the changed file\'s text — with its own detector', async () => {
  const root = contentFixture();
  try {
    // A script that reads a workflow by text selects assert-workflow-readers, whatever directory it is in.
    const reader = await run(root, ['--list', '--paths', 'misc/reads-ci.mjs']);
    assert.equal(reader.code, 0, reader.out);
    assert.deepEqual(selectedIds(reader.out), ['guard:assert-workflow-readers'], reader.out);
    assert.match(reader.out, /tier 1 {2}guard:assert-workflow-readers/);
    // GREEN control: its neighbour, which reads no workflow, does not.
    const quiet = await run(root, ['--list', '--paths', 'misc/reads-nothing.mjs']);
    assert.ok(!selectedIds(quiet.out).includes('guard:assert-workflow-readers'), quiet.out);
    // A prose edit carrying a claim shape selects assert-mechanism-claims, and is mapped by it.
    const prose = await run(root, ['--list', '--paths', 'docs/claim.md']);
    assert.equal(prose.code, 0, prose.out);
    assert.deepEqual(selectedIds(prose.out), ['guard:assert-mechanism-claims'], prose.out);
    assert.match(prose.out, /coverage 1\/1 changed paths mapped \(100%\)/);
    // GREEN control: prose with no shape is still only what lane-map declares ungraded.
    const plain = await run(root, ['--list', '--paths', 'docs/a.md']);
    assert.deepEqual(selectedIds(plain.out), [], plain.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AG9 🔴 a content rule that can no longer read its guard\'s declaration is COVERAGE LOST, not a silent no-match', async () => {
  const root = contentFixture((rel, text) => (rel.endsWith('assert-workflow-readers.mjs') ? text.replace('const READS = [', 'const READ_SHAPES = [') : text));
  try {
    const r = await run(root, ['--list', '--paths', 'misc/reads-ci.mjs']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/ci\/assert-workflow-readers\.mjs no longer declares `const READS = \[/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('AG9 the REAL tree: tooling/ops/land-rules.mjs selects assert-workflow-readers (the #1076 miss)', async () => {
  const r = await run(REPO, ['--list', '--paths', 'tooling/ops/land-rules.mjs']);
  assert.equal(r.code, 0, r.out);
  assert.ok(selectedIds(r.out).includes('guard:assert-workflow-readers'), r.out);
});
