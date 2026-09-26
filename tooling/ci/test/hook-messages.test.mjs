// hook-messages.test.mjs — what the hooks PRINT when they refuse
// (O-PUBLIC-HOOKS-ADVERTISE-NO-VERIFY).
//
// Until 2026-09-24 both hooks answered a red runner with the same two lines, and
// the second printed the bypass as an override: `git commit --no-verify`. That
// is the one instruction AGENTS.md prohibits twice, printed at the moment a writer
// is most tempted, and it did not tell a refusal (exit 2, "could not check from
// here") from a finding (exit 1, "what you staged is wrong"). Those two are fixed
// differently, so they are now worded apart, and neither offers a way past the hook.
//
// These cases drive the REAL .githooks/pre-commit and .githooks/pre-push in a
// throwaway git repo with a STUB runner at tooling/scripts/spec-guards.mjs (the
// first candidate each hook resolves, `<hooks dir>/../tooling/scripts/`), the
// pattern precommit-pii.test.mjs uses. The stub exits with STUB_RUNNER_EXIT, so
// each branch of each hook is taken on purpose. check-agent-docs.mjs limb
// X-NO-VERIFY grades the same text in CI; this file grades what a person sees.
//
// Run:  node --test "tooling/ci/test/hook-messages.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PRE_COMMIT = join(REPO, '.githooks', 'pre-commit');
const PRE_PUSH = join(REPO, '.githooks', 'pre-push');
const RUNNER_SRC = join(REPO, 'tooling', 'scripts', 'spec-guards.mjs');

/** A throwaway repo carrying both real hooks and a stub runner. No .gitleaks.toml,
 *  so pre-commit's PII block is not reached; precommit-pii.test.mjs owns that. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'hook-messages-'));
  const r = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git init -> ${r.status} ${r.stderr}`);
  mkdirSync(join(root, '.githooks'));
  copyFileSync(PRE_COMMIT, join(root, '.githooks', 'pre-commit'));
  copyFileSync(PRE_PUSH, join(root, '.githooks', 'pre-push'));
  mkdirSync(join(root, 'tooling', 'scripts'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'scripts', 'spec-guards.mjs'), [
    "const code = Number(process.env.STUB_RUNNER_EXIT ?? '0');",
    "if (code === 1) console.log('  FAIL stub-guard   a finding in the staged change');",
    "if (code === 2) console.log('  ERR  stub-guard   could not reach its subject');",
    'process.exit(code);',
    '',
  ].join('\n'));
  return root;
}

function runHook(root, hook, runnerExit) {
  const r = spawnSync('sh', [`.githooks/${hook}`], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, STUB_RUNNER_EXIT: String(runnerExit) },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Every printed line that names the flag without a prohibition beside it. The
 *  hook may say "never --no-verify"; it may not print the flag as a way forward. */
function bypassLines(out) {
  return out.split('\n').filter((l) => l.includes('--no-verify') && !/\bnever\b/i.test(l));
}

test('H1 pre-commit, a FINDING (runner exit 1): exit 1, names the first FAIL line, prints no bypass', () => {
  const root = sandbox();
  try {
    const green = runHook(root, 'pre-commit', 0);
    assert.equal(green.code, 0, `green control first, or the refusal below proves nothing: ${green.out}`);
    assert.doesNotMatch(green.out, /refused/);

    const r = runHook(root, 'pre-commit', 1);
    assert.equal(r.code, 1, `the runner's exit must pass through unchanged: ${r.out}`);
    assert.match(r.out, /pre-commit: the spec guards are not clean \(exit 1\)\. Commit refused\./);
    assert.match(r.out, /Read the first FAIL line above, fix what it names/);
    assert.deepEqual(bypassLines(r.out), [], `the hook printed the bypass as a way forward: ${r.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('H2 pre-commit, a REFUSAL (runner exit 2): exit 2, names the runner and Projects/.worktrees/, prints no bypass', () => {
  const root = sandbox();
  try {
    const r = runHook(root, 'pre-commit', 2);
    assert.equal(r.code, 2, `a refusal must stay exit 2, which is not a finding and not a pass: ${r.out}`);
    assert.match(r.out, /pre-commit: the spec guards could not run from this checkout \(exit 2\)\. Commit refused\./);
    assert.match(r.out, /runner: \.githooks\/\.\.\/tooling\/scripts\/spec-guards\.mjs/, `the refusal must name the runner it ran: ${r.out}`);
    assert.match(r.out, /Projects\/\.worktrees\//, `a location refusal must say where to commit from: ${r.out}`);
    assert.doesNotMatch(r.out, /first FAIL line/, 'a refusal is not a finding, and must not be worded as one');
    assert.deepEqual(bypassLines(r.out), [], `the hook printed the bypass as a way forward: ${r.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('H3 pre-push, a FINDING (runner exit 1): exit 1, names the first FAIL line, prints no bypass', () => {
  const root = sandbox();
  try {
    const green = runHook(root, 'pre-push', 0);
    assert.equal(green.code, 0, `green control first: ${green.out}`);

    const r = runHook(root, 'pre-push', 1);
    assert.equal(r.code, 1, `the runner's exit must pass through unchanged: ${r.out}`);
    assert.match(r.out, /pre-push: the spec guards are not clean \(exit 1\)\. Push refused\./);
    assert.match(r.out, /Read the first FAIL line above, fix what it names/);
    assert.deepEqual(bypassLines(r.out), [], `the hook printed the bypass as a way forward: ${r.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('H4 pre-push, a REFUSAL (runner exit 2): exit 2, names the runner and Projects/.worktrees/, prints no bypass', () => {
  const root = sandbox();
  try {
    const r = runHook(root, 'pre-push', 2);
    assert.equal(r.code, 2, `a refusal must stay exit 2: ${r.out}`);
    assert.match(r.out, /pre-push: the spec guards could not run from this checkout \(exit 2\)\. Push refused\./);
    assert.match(r.out, /runner: \.githooks\/\.\.\/tooling\/scripts\/spec-guards\.mjs/, `the refusal must name the runner it ran: ${r.out}`);
    assert.match(r.out, /Projects\/\.worktrees\//, `a location refusal must say where to push from: ${r.out}`);
    assert.doesNotMatch(r.out, /first FAIL line/, 'a refusal is not a finding, and must not be worded as one');
    assert.deepEqual(bypassLines(r.out), [], `the hook printed the bypass as a way forward: ${r.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('H5 spec-guards.mjs, its two closing messages: exit 2 keeps "could not run", exit 1 names the first FAIL line, neither prints a bypass', () => {
  /* The runner's own tail is read from source rather than run: reaching it needs a
     workspace anchor, a private corpus and a guard set, which is what
     spec-guards-worktree.test.mjs builds, and that file already matches
     /could not run/ on a live exit 2. This case pins the WORDING of both tails. */
  const src = readFileSync(RUNNER_SRC, 'utf8');
  const from = src.lastIndexOf('if (broke.length) {');
  assert.notEqual(from, -1, 'spec-guards.mjs no longer ends on `if (broke.length) {` — this case is reading the wrong thing');
  const tail = src.slice(from);
  const redAt = tail.indexOf('if (red.length) {');
  assert.notEqual(redAt, -1, 'spec-guards.mjs no longer has an `if (red.length) {` branch after the broke branch');
  const broke = tail.slice(0, redAt);
  const red = tail.slice(redAt);
  assert.match(broke, /could not run/, 'the exit-2 text lost "could not run", which spec-guards-worktree.test.mjs matches');
  assert.match(broke, /process\.exit\(2\)/);
  assert.match(broke, /first ERR line/);
  assert.match(red, /process\.exit\(1\)/);
  assert.match(red, /first FAIL line/);
  assert.deepEqual(bypassLines(broke), [], `the exit-2 tail prints the bypass: ${broke}`);
  assert.deepEqual(bypassLines(red), [], `the exit-1 tail prints the bypass: ${red}`);
});
