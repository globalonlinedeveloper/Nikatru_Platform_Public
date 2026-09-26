// ─────────────────────────────────────────────────────────────────────────────
// hook-runner-pin.test.mjs — the private corpus's hooks run from ONE detached
// worktree pinned to origin/main, and that worktree advances itself.
//
// O-PRIVATE-HOOK-RUNNER-FOLLOWS-A-LIVE-BRANCH. The corpus's `core.hooksPath` used
// to be relative to whichever tree `install-hooks.mjs` last ran in: the main
// checkout on whatever branch it held, or a lane worktree deleted on merge. So a
// corpus commit was graded by whatever rules that tree happened to hold.
// `tooling/scripts/hook-runner-pin.mjs` is the one module that says where the
// runner is, what state it is in, how it advances, and whether the tree a corpus
// hook loaded is the runner at all. This file drives it against REAL git: a bare
// origin, a clone of it, a detached `git worktree add` at
// `.worktrees/hooks-runner-main`, and real fetches that move `origin/main`.
// Nothing less exercises `--git-common-dir`, `symbolic-ref` and a moving
// remote-tracking ref, which are the only things the module rests on.
//
// ⚠️ THE CASES ARE ORDERED AND SHARE ONE FIXTURE. Each one that moves origin/main
// or disturbs the runner puts the runner back to `current` before it returns, so
// the next case starts from the state its title assumes.
//
// The hook-level cases run the REAL `.githooks/pre-commit` from the runner with a
// STUB `spec-guards.mjs` that prints the commit it came from, so what is asserted
// is which hook text and which runner judged the commit — the block's whole job.
//
// Run:  node --test "tooling/ci/test/hook-runner-pin.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  RUNNER_BASENAME, runnerDirOf, runnerHooksPathOf, runnerState, advanceRunner,
  runnerDrift, invokingCheckout, sameDir,
} from '../../scripts/hook-runner-pin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // tooling/ci/test -> repo root
const SCRIPTS = join(REPO, 'tooling', 'scripts');

let BASE;    // the throwaway workspace
let ORIGIN;  // <BASE>/origin.git — the bare "origin"
let SEED;    // <BASE>/seed — where fixture commits are authored and pushed from
let PUB;     // <BASE>/Projects/Acme_Public — the main checkout, a clone of ORIGIN
let RUNNER;  // <BASE>/Projects/.worktrees/hooks-runner-main — the pinned runner
let CORPUS;  // <BASE>/Projects/Acme_Private — a repo with no hooks config, the hook's cwd

const IDENT = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
const git = (where, ...args) => {
  const r = spawnSync('git', [...IDENT, '-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture git -C ${where} ${args.join(' ')} -> ${r.status}\n${r.stderr}`);
  return (r.stdout ?? '').trim();
};
const write = (abs, text) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text, 'utf8'); };

/** The stub runner: prints the label of the commit it came from, and passes. */
const stubRunner = (label) => `console.log('stub runner ${label}');\nprocess.exit(0);\n`;
/** The stub smoke: `--smoke --sha <sha>` prints `stub smoke <sha>` and passes (PF1-3). */
const STUB_PREFLIGHT = "const i = process.argv.indexOf('--sha');\nconsole.log('stub smoke ' + process.argv[i + 1]);\nprocess.exit(0);\n";

/** Author one commit in SEED, push it as origin/main, and fetch it into PUB — the
 *  only way origin/main moves in real life. `hookText` replaces pre-commit when given. */
function advanceOrigin(label, hookText = null) {
  write(join(SEED, 'tooling', 'scripts', 'spec-guards.mjs'), stubRunner(label));
  if (hookText !== null) write(join(SEED, '.githooks', 'pre-commit'), hookText);
  git(SEED, 'add', '-A');
  git(SEED, 'commit', '-q', '-m', label);
  git(SEED, 'push', '-q', 'origin', 'HEAD:main');
  git(PUB, 'fetch', '-q', 'origin');
  return git(PUB, 'rev-parse', 'origin/main');
}

/** Run the RUNNER's real pre-commit from the corpus, as git would. */
function runHook(extraEnv = {}, { hook = 'pre-commit', input } = {}) {
  const env = { ...process.env, ...extraEnv };
  if (!('NIKATRU_RUNNER_ADVANCED' in extraEnv)) delete env.NIKATRU_RUNNER_ADVANCED;
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync('sh', [join(RUNNER, '.githooks', hook)], { cwd: CORPUS, env, encoding: 'utf8', timeout: 60_000, input });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

before(() => {
  BASE = realpathSync.native(mkdtempSync(join(tmpdir(), 'hook-runner-pin-')));
  ORIGIN = join(BASE, 'origin.git');
  SEED = join(BASE, 'seed');
  PUB = join(BASE, 'Projects', 'Acme_Public');
  RUNNER = join(BASE, 'Projects', '.worktrees', RUNNER_BASENAME);
  CORPUS = join(BASE, 'Projects', 'Acme_Private');

  mkdirSync(ORIGIN, { recursive: true });
  git(ORIGIN, 'init', '-q', '--bare');
  git(ORIGIN, 'symbolic-ref', 'HEAD', 'refs/heads/main');

  mkdirSync(SEED, { recursive: true });
  git(SEED, 'init', '-q');
  git(SEED, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  for (const h of ['pre-commit', 'pre-push']) {
    mkdirSync(join(SEED, '.githooks'), { recursive: true });
    copyFileSync(join(REPO, '.githooks', h), join(SEED, '.githooks', h));
  }
  for (const f of ['install-hooks.mjs', 'repo-git.mjs', 'hook-runner-pin.mjs']) {
    mkdirSync(join(SEED, 'tooling', 'scripts'), { recursive: true });
    copyFileSync(join(SCRIPTS, f), join(SEED, 'tooling', 'scripts', f));
  }
  write(join(SEED, 'tooling', 'scripts', 'spec-guards.mjs'), stubRunner('v1'));
  // pre-push finds the smoke as `$(dirname "$RUNNER")/preflight.mjs` (PF1-3).
  write(join(SEED, 'tooling', 'scripts', 'preflight.mjs'), STUB_PREFLIGHT);
  git(SEED, 'add', '-A');
  git(SEED, 'commit', '-q', '-m', 'v1');
  git(SEED, 'remote', 'add', 'origin', ORIGIN);
  git(SEED, 'push', '-q', 'origin', 'HEAD:main');

  mkdirSync(dirname(PUB), { recursive: true });
  git(dirname(PUB), 'clone', '-q', ORIGIN, PUB);
  git(PUB, 'config', 'core.autocrlf', 'false');
  git(PUB, 'worktree', 'add', '-q', '--detach', RUNNER, 'origin/main');

  mkdirSync(CORPUS, { recursive: true });
  git(CORPUS, 'init', '-q');
});

after(() => {
  try { git(PUB, 'worktree', 'remove', '--force', RUNNER); } catch { /* the rm below is the real cleanup */ }
  try { rmSync(BASE, { recursive: true, force: true }); } catch { /* Windows may hold a handle; temp litter is harmless */ }
});

test('the runner sits beside the main checkout, and the corpus pointer to it is absolute with forward slashes', () => {
  assert.ok(sameDir(runnerDirOf(PUB), RUNNER), `runnerDirOf(${PUB}) = ${runnerDirOf(PUB)}, expected ${RUNNER}`);
  const hp = runnerHooksPathOf(PUB);
  assert.ok(isAbsolute(hp), `the corpus pointer must be absolute; a relative one is resolved against the corpus: ${hp}`);
  assert.doesNotMatch(hp, /\\/, `the corpus pointer must use forward slashes: ${hp}`);
  assert.match(hp, /\/\.worktrees\/hooks-runner-main\/\.githooks$/, hp);
});

test('runnerState: a detached worktree at origin/main is current', () => {
  const st = runnerState(PUB);
  assert.equal(st.status, 'current', `${st.status}: ${st.why}`);
  assert.equal(st.head, git(PUB, 'rev-parse', 'origin/main'));
  assert.equal(st.branch, null);
  assert.deepEqual(st.hooksMissing, []);
});

test('runnerState: no runner directory is absent, and says where it looked', () => {
  const lonely = join(BASE, 'Lonely', 'Acme_Public');
  const st = runnerState(lonely);
  assert.equal(st.status, 'absent', `${st.status}: ${st.why}`);
  assert.ok(st.why.includes(runnerDirOf(lonely)), st.why);
});

test('runnerState: a directory at the runner path that is its own repository is foreign, not current', () => {
  const host = join(BASE, 'Else', 'Other_Public');
  const imposter = runnerDirOf(host);
  mkdirSync(imposter, { recursive: true });
  git(imposter, 'init', '-q');
  write(join(imposter, 'x.txt'), 'x\n');
  git(imposter, 'add', '-A');
  git(imposter, 'commit', '-q', '-m', 'imposter');
  const st = runnerState(host);
  assert.equal(st.status, 'foreign', `${st.status}: ${st.why}`);
});

test('invokingCheckout: a linked worktree answers with its main checkout, a subdirectory with its repo, no repo with null', () => {
  assert.ok(sameDir(invokingCheckout(RUNNER), PUB), `from the runner: ${invokingCheckout(RUNNER)}`);
  const sub = join(CORPUS, 'deep', 'er');
  mkdirSync(sub, { recursive: true });
  assert.ok(sameDir(invokingCheckout(sub), CORPUS), `from a subdirectory: ${invokingCheckout(sub)}`);
  assert.equal(invokingCheckout(BASE), null, 'the workspace itself is in no repository');
});

test('advanceRunner: a tree not named like the runner leaves at once, before any git call', () => {
  // Not a repository at all: had it asked git, the election would have failed and the
  // answer would be code 2. Code 0 here is the proof that it never asked.
  const nowhere = join(BASE, 'not-a-repo');
  mkdirSync(nowhere, { recursive: true });
  assert.deepEqual(advanceRunner(nowhere), { code: 0, lines: [] });
  assert.deepEqual(advanceRunner(PUB), { code: 0, lines: [] });
});

test('advanceRunner: a current runner is left where it is (0)', () => {
  const head = git(RUNNER, 'rev-parse', 'HEAD');
  assert.deepEqual(advanceRunner(RUNNER), { code: 0, lines: [] });
  assert.equal(git(RUNNER, 'rev-parse', 'HEAD'), head);
});

test('runnerState: a fetch that moves origin/main makes the runner stale; advanceRunner moves it (3) and reads it back', () => {
  const want = advanceOrigin('v2');
  const st = runnerState(PUB);
  assert.equal(st.status, 'stale', `${st.status}: ${st.why}`);
  assert.notEqual(st.head, want);
  const r = advanceRunner(RUNNER);
  assert.equal(r.code, 3, r.lines.join('\n'));
  assert.match(r.lines.join('\n'), /advanced/);
  assert.equal(git(RUNNER, 'rev-parse', 'HEAD'), want);
  assert.equal(runnerState(PUB).status, 'current');
});

test('the self-advance block: a stale runner advances, and the re-run executes the NEW hook text and the NEW runner', () => {
  const hook = readFileSync(join(SEED, '.githooks', 'pre-commit'), 'utf8');
  assert.ok(hook.includes('set -u\n'), 'the hook no longer has `set -u` to anchor the marker on, so this case cannot build its v3 hook');
  const want = advanceOrigin('v3', hook.replace('set -u\n', 'set -u\necho "HOOK-TEXT v3" >&2\n'));
  const r = runHook();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /hook runner: advanced/, `the block did not advance the runner:\n${r.out}`);
  assert.equal((r.out.match(/HOOK-TEXT v3/g) ?? []).length, 1, `the new hook text must run exactly ONCE — zero means no re-exec, two means the once-guard failed:\n${r.out}`);
  assert.match(r.out, /stub runner v3/, `the commit was judged by the old runner:\n${r.out}`);
  assert.equal(git(RUNNER, 'rev-parse', 'HEAD'), want);
});

test('the self-advance block: with NIKATRU_RUNNER_ADVANCED already set, nothing moves — the advance happens once', () => {
  const before = git(RUNNER, 'rev-parse', 'HEAD');
  advanceOrigin('v4');
  const r = runHook({ NIKATRU_RUNNER_ADVANCED: '1' });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /hook runner: advanced/, r.out);
  assert.match(r.out, /stub runner v3/, `the runner moved although the guard variable was set:\n${r.out}`);
  assert.equal(git(RUNNER, 'rev-parse', 'HEAD'), before);
  // restore: the next case starts from a current runner
  assert.equal(advanceRunner(RUNNER).code, 3);
});

test('the self-advance block: a runner already at origin/main runs as it is, without re-executing', () => {
  const r = runHook();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /hook runner: advanced/, r.out);
  assert.equal((r.out.match(/HOOK-TEXT v3/g) ?? []).length, 1, `a current runner must run its hook text once, not re-execute it:\n${r.out}`);
  assert.match(r.out, /stub runner v4/, r.out);
});

test('advanceRunner: a stale runner carrying a tracked edit is refused (1), and the edit survives', () => {
  advanceOrigin('v5');
  const head = git(RUNNER, 'rev-parse', 'HEAD');
  const edited = join(RUNNER, 'tooling', 'scripts', 'spec-guards.mjs');
  write(edited, stubRunner('hand-edited'));
  try {
    assert.equal(runnerState(PUB).status, 'dirty');
    const r = advanceRunner(RUNNER);
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /dirty/);
    assert.equal(git(RUNNER, 'rev-parse', 'HEAD'), head, 'a dirty runner was moved');
    assert.equal(readFileSync(edited, 'utf8'), stubRunner('hand-edited'), 'the edit was discarded');
    const hook = runHook();
    assert.equal(hook.code, 1, `the hook must refuse when the runner cannot be advanced:\n${hook.out}`);
    assert.match(hook.out, /Commit refused/, hook.out);
  } finally {
    git(RUNNER, 'checkout', '-q', '--', '.');
  }
  assert.equal(advanceRunner(RUNNER).code, 3);
});

test('advanceRunner: a runner with a BRANCH checked out is refused (1) and left on it', () => {
  advanceOrigin('v6');
  git(RUNNER, 'switch', '-q', '-c', 'live-branch');
  try {
    assert.equal(runnerState(PUB).status, 'on-branch');
    const r = advanceRunner(RUNNER);
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.equal(git(RUNNER, 'symbolic-ref', '--short', 'HEAD'), 'live-branch', 'the branch checkout was moved off its branch');
  } finally {
    git(RUNNER, 'checkout', '-q', '--detach');
    git(PUB, 'branch', '-q', '-D', 'live-branch');
  }
  assert.equal(advanceRunner(RUNNER).code, 3);
});

test('runnerDrift: the pinned runner at origin/main is clean (0)', () => {
  assert.deepEqual(runnerDrift(RUNNER), { code: 0, lines: [] });
});

test('runnerDrift: a branch checkout that loaded the runner is a finding (1) that names the checkout and its branch', () => {
  const r = runnerDrift(PUB);
  assert.equal(r.code, 1, r.lines.join('\n'));
  const text = r.lines.join('\n');
  assert.ok(text.includes(PUB), `the finding must name the tree that loaded the runner:\n${text}`);
  assert.match(text, /branch `main`/, text);
  assert.ok(text.includes(RUNNER), `the finding must name the pinned runner:\n${text}`);
});

test('with no origin/main ref, whether the runner is current is unknown: advanceRunner and runnerDrift both answer 2', () => {
  git(PUB, 'update-ref', '-d', 'refs/remotes/origin/main');
  try {
    assert.equal(runnerState(PUB).status, 'no-ref');
    const adv = advanceRunner(RUNNER);
    assert.equal(adv.code, 2, adv.lines.join('\n'));
    const drift = runnerDrift(RUNNER);
    assert.equal(drift.code, 2, drift.lines.join('\n'));
  } finally {
    git(PUB, 'fetch', '-q', 'origin');
  }
  assert.equal(runnerState(PUB).status, 'current', 'the fetch did not restore origin/main to the runner\'s commit');
});

test('runnerDrift: the pinned runner behind origin/main is a finding (1)', () => {
  advanceOrigin('v7');
  try {
    const r = runnerDrift(RUNNER);
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /stale/);
  } finally {
    assert.equal(advanceRunner(RUNNER).code, 3);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-26 (train W17, PF1-3). pre-push reads the pushed refs from stdin ONCE, and
// the self-advance block re-runs the hook with `exec`. Measured 2026-09-25: a read
// placed BEFORE the block left the re-run 0 bytes, so a push that advanced a stale
// runner printed "no commit to smoke" and exited 0 — a false green on exactly the push
// that moved the runner. The read sits after the block; these two cases pin it.
// ─────────────────────────────────────────────────────────────────────────────
const PUSHED_SHA = 'c0ffee0000000000000000000000000000000001';
const PUSH_STDIN = `refs/heads/t ${PUSHED_SHA} refs/heads/t 0000000000000000000000000000000000000000\n`;

test('pre-push: a stale runner advances, and the re-run still reads the pushed refs and smokes the commit once', () => {
  const want = advanceOrigin('v8');
  const r = runHook({}, { hook: 'pre-push', input: PUSH_STDIN });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /hook runner: advanced/, `the block did not advance the runner:\n${r.out}`);
  assert.equal((r.out.match(new RegExp(`stub smoke ${PUSHED_SHA}`, 'g')) ?? []).length, 1, `the re-run must smoke the pushed commit exactly once — zero means the refs were read before the exec:\n${r.out}`);
  assert.equal(git(RUNNER, 'rev-parse', 'HEAD'), want);
});

test('pre-push: a current runner reads the pushed refs and smokes the commit once', () => {
  const r = runHook({}, { hook: 'pre-push', input: PUSH_STDIN });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /hook runner: advanced/, r.out);
  assert.equal((r.out.match(new RegExp(`stub smoke ${PUSHED_SHA}`, 'g')) ?? []).length, 1, `a current runner must smoke the pushed commit exactly once:\n${r.out}`);
});
