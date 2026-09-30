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
//
// Run:  node --test "tooling/ci/test/affected-guards.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main, parseNodeCall, scanSource } from '../../scripts/affected-guards.mjs';

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
  put(root, 'tooling/ci/lane-map.json', JSON.stringify({
    lanes: { guards: { globs: ['tooling/**', '.github/**', 'data/**', 'other/**', 'misc/**'] } },
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
  // join chains: the base argument drops, a later non-literal is "any path"
  const { chains } = scanSource("const a = join(ROOT, 'apps', app, 'pubspec.yaml'); const b = join(HERE, '..', 'x.json');");
  assert.deepEqual(chains.map((c) => c.parts), [['apps', '\u0000', 'pubspec.yaml'], ['..', 'x.json']]);
});
