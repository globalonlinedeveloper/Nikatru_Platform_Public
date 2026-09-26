// ─────────────────────────────────────────────────────────────────────────────
// hook-runner-pin.mjs — which tree the private corpus's hooks run from, and
// whether that tree is still the one origin/main carries.
//
// ⏱ 2026-09-24 (O-PRIVATE-HOOK-RUNNER-FOLLOWS-A-LIVE-BRANCH). The corpus has no
// hooks of its own. Its `core.hooksPath` points at THIS repository's `.githooks/`,
// and those hooks run THIS repository's `tooling/scripts/spec-guards.mjs`. Until
// today that pointer was RELATIVE to whichever tree `install-hooks.mjs` was last
// run from, which made it one of two bad things:
//   · the MAIN checkout, which sits on whatever branch its owner last switched to,
//     so a corpus commit was judged by a half-written guard on a feature branch;
//   · a LANE worktree, when the installer was run from one (measured in a scratch
//     pair: `../.worktrees/lane-r4/.githooks`), which is deleted when the lane
//     merges — and git runs no hook from a directory that is gone, silently.
// Either way the rules that graded the corpus were a property of where somebody
// happened to be standing, not of origin/main.
//
// THE PIN. The corpus points at ONE detached worktree of this repository:
//     <parent of the main checkout>/.worktrees/hooks-runner-main
// checked out at the LOCAL `origin/main` ref. The directory is computed from the
// elected main checkout (`mainCheckoutOf`, the election install-hooks.mjs and
// spec-guards.mjs already make for the corpus itself), so a run from the main
// checkout and a run from any lane of it compute the same directory.
//
// THREE CALLERS:
//   install-hooks.mjs --pin-private    writes the corpus pointer: absolute, forward
//                                      slashes, and only when the runner is here.
//   install-hooks.mjs --advance-runner the hooks' self-advance: moves the runner to
//                                      the local origin/main. NO FETCH, EVER — a
//                                      hook that dials out is a hook that hangs.
//   spec-guards.mjs (the drift limb)   from a corpus commit, refuses a runner that is
//                                      not the pin, is on a branch, carries edits, or
//                                      is not at origin/main.
//
// Every git call goes through repo-git.mjs: this runs INSIDE hooks, where git
// exports GIT_INDEX_FILE (and can export GIT_DIR) and they beat `-C`. A
// `git -C <runner> checkout` that inherits the corpus's GIT_INDEX_FILE treats the
// CORPUS's index as the runner's — measured 2026-09-24 in a scratch pair, it read
// the corpus's entries as local edits and refused to check out.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, statSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { repoGit, repoGitRaw, RepoGitError, mainCheckoutOf } from './repo-git.mjs';

/** The runner's directory name, under `.worktrees/` beside the main checkout. */
export const RUNNER_BASENAME = 'hooks-runner-main';
/** The ref the runner is pinned to. A LOCAL remote-tracking ref: whoever fetches
 *  moves it, and nothing in this module ever fetches. */
export const RUNNER_REF = 'origin/main';
/** The hook files a runner must carry for the corpus pointer to mean anything —
 *  git runs NO hook from a directory that lacks it, and says nothing. */
export const RUNNER_HOOKS = Object.freeze(['pre-commit', 'pre-push']);

const slash = (p) => String(p).replace(/\\/g, '/');
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const short = (sha) => (sha ? String(sha).slice(0, 12) : '(none)');

/** Two spellings of one directory compare equal: separators, a trailing slash, the
 *  8.3 short form and a symlinked temp root (both canonicalised by realpath), and
 *  case where the platform folds it. Same rule as repo-git.mjs's `sameDir`. */
export function sameDir(a, b) {
  const norm = (p) => {
    let s = resolve(String(p));
    try { s = realpathSync.native(s); } catch { /* not on disk — compare the text */ }
    s = slash(s).replace(/\/+$/, '');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  return norm(a) === norm(b);
}

/** The runner directory for the main checkout `hostRoot`. */
export function runnerDirOf(hostRoot) {
  return join(dirname(resolve(hostRoot)), '.worktrees', RUNNER_BASENAME);
}

/** The value the corpus's `core.hooksPath` must hold: ABSOLUTE, forward slashes.
 *  Absolute because the corpus and the runner are two different directories whose
 *  only fixed relation is through the main checkout, and a relative value is
 *  resolved by git against the corpus — the thing that let the old value land in
 *  whatever tree the installer ran from. */
export function runnerHooksPathOf(hostRoot) {
  return slash(join(runnerDirOf(hostRoot), '.githooks'));
}

/** The branch `root` has checked out, or null when HEAD is detached. Throws
 *  RepoGitError when git cannot answer. */
function branchOf(root) {
  const r = repoGitRaw(root, ['symbolic-ref', '-q', '--short', 'HEAD']);
  if (r.status === 0) return (r.stdout ?? '').trim() || null;
  if (r.status === 1) return null;          // detached: data, not a failure
  throw new RepoGitError('status', `\`git symbolic-ref -q HEAD\` exited ${r.status} in ${root}.`, (r.stderr ?? '').trim());
}

/**
 * The state of the runner for the main checkout `hostRoot`. Never throws for a git
 * refusal: that is `status: 'unreadable'`, with the reason on `why`.
 *
 *   absent      no directory at the runner path
 *   foreign     a directory, but not a worktree of `hostRoot`'s repository
 *   on-branch   a worktree with a BRANCH checked out — a live checkout, the defect
 *   no-ref      RUNNER_REF does not resolve, so "is it current" has no answer
 *   dirty       tracked files carry edits (untracked files are not read)
 *   stale       detached and clean, but HEAD is not RUNNER_REF
 *   current     detached, clean, HEAD === RUNNER_REF
 *   unreadable  git could not answer
 *
 * `hooksMissing` is reported beside the status, not folded into it: a current runner
 * at a commit with no `.githooks/` is still current, and still runs nothing.
 */
export function runnerState(hostRoot) {
  const dir = runnerDirOf(hostRoot);
  const s = {
    dir, hooksPath: runnerHooksPathOf(hostRoot),
    status: null, why: '', head: null, want: null, branch: null, dirty: [], hooksMissing: [],
  };
  if (!isDir(dir)) return { ...s, status: 'absent', why: `there is no directory at ${dir}` };
  s.hooksMissing = RUNNER_HOOKS.filter((h) => !existsSync(join(dir, '.githooks', h)));
  try {
    const common = resolve(dir, repoGit(dir, 'rev-parse', '--git-common-dir').trim());
    if (basename(common) !== '.git' || !sameDir(dirname(common), hostRoot)) {
      return { ...s, status: 'foreign', why: `${dir} is a checkout of ${common}, not a worktree of ${hostRoot}` };
    }
    s.head = repoGit(dir, 'rev-parse', 'HEAD').trim();
    s.branch = branchOf(dir);
    const ref = repoGitRaw(dir, ['rev-parse', '--verify', '-q', `${RUNNER_REF}^{commit}`]);
    if (ref.status === 0) s.want = (ref.stdout ?? '').trim();
    else if (ref.status !== 1) throw new RepoGitError('status', `\`git rev-parse --verify ${RUNNER_REF}\` exited ${ref.status} in ${dir}.`, (ref.stderr ?? '').trim());
    s.dirty = repoGit(dir, 'status', '--porcelain', '--untracked-files=no').split('\n').map((l) => l.trimEnd()).filter(Boolean);
  } catch (e) {
    if (!(e instanceof RepoGitError)) throw e;
    if (e.kind === 'toplevel') return { ...s, status: 'foreign', why: `${dir} is not a git checkout of its own: ${e.message}` };
    return { ...s, status: 'unreadable', why: `${e.message} ${e.detail}`.replace(/\s+/g, ' ').trim() };
  }
  if (s.branch) return { ...s, status: 'on-branch', why: `${dir} has branch \`${s.branch}\` checked out; the runner must be detached at ${RUNNER_REF}` };
  if (!s.want) return { ...s, status: 'no-ref', why: `${RUNNER_REF} does not resolve in ${dir}, so there is nothing to pin to` };
  if (s.dirty.length) return { ...s, status: 'dirty', why: `${s.dirty.length} tracked file(s) in ${dir} carry edits: ${s.dirty.slice(0, 3).join(' ; ')}` };
  if (s.head !== s.want) return { ...s, status: 'stale', why: `${dir} is at ${short(s.head)}, ${RUNNER_REF} is ${short(s.want)}` };
  return { ...s, status: 'current', why: `${dir} is detached at ${RUNNER_REF} (${short(s.head)})` };
}

/** The command that creates the runner, for every message that finds it absent.
 *  Printed, never run: creating it is the owner's step. */
export function createRunnerCommand(hostRoot) {
  return `git -C ${slash(hostRoot)} worktree add --detach ${slash(runnerDirOf(hostRoot))} ${RUNNER_REF}`;
}

/**
 * The hooks' self-advance, for the tree `repo` a hook was loaded from. Returns
 * `{ code, lines }`, and the hook reads `code`:
 *   0  nothing moved — `repo` is not the runner, or the runner is already current.
 *   3  ADVANCED — the runner now sits at RUNNER_REF, so the hook file on disk may be
 *      new text; the hook re-executes itself ONCE (NIKATRU_RUNNER_ADVANCED).
 *   1  the runner is off its pin and was NOT moved: on a branch, carrying edits,
 *      not a worktree of this repository, or the checkout failed.
 *   2  git could not answer, or RUNNER_REF does not resolve, so whether it is
 *      current is unknown — the same two states the drift limb calls COVERAGE LOST.
 * Every tree that is not named like the runner leaves on the first line, before any
 * git call — this runs on every commit in every checkout of this repository, and a
 * public clone must pay nothing for it.
 */
export function advanceRunner(repo) {
  if (basename(resolve(repo)) !== RUNNER_BASENAME) return { code: 0, lines: [] };
  const elected = mainCheckoutOf(repo);
  if (!elected.main) {
    return { code: 2, lines: [`hook runner: ${repo} is named like the runner, but its main checkout could not be elected: ${elected.why}`] };
  }
  if (!sameDir(runnerDirOf(elected.main), repo)) return { code: 0, lines: [] };
  const st = runnerState(elected.main);
  if (st.status === 'current') return { code: 0, lines: [] };
  if (st.status === 'unreadable' || st.status === 'no-ref') {
    return { code: 2, lines: [`hook runner: ${st.status} — ${st.why}; whether it is current is unknown.`] };
  }
  if (st.status !== 'stale') {
    return { code: 1, lines: [
      `hook runner: ${st.status} — ${st.why}.`,
      '  Not advanced: only a clean, detached runner is moved, and nothing here discards an edit or leaves a branch.',
    ] };
  }
  const r = repoGitRaw(st.dir, ['checkout', '--detach', '--quiet', st.want]);
  if (r.status !== 0) {
    return { code: 1, lines: [`hook runner: \`git checkout --detach ${short(st.want)}\` exited ${r.status} in ${st.dir}: ${(r.stderr ?? '').trim()}`] };
  }
  // Read back, never trust the write: a checkout that exits 0 and leaves HEAD where it was
  // is indistinguishable from an advance unless HEAD is asked again.
  const after = runnerState(elected.main);
  if (after.status !== 'current') {
    return { code: 1, lines: [`hook runner: checked out ${short(st.want)}, read back ${after.status} — ${after.why}`] };
  }
  return { code: 3, lines: [`hook runner: advanced ${short(st.head)} -> ${short(after.head)} (${RUNNER_REF}) in ${st.dir}`] };
}

/** The main checkout of the repository `cwd` sits in, found by walking up to the
 *  first `.git` (a directory in a main checkout, a file in a linked worktree) and
 *  electing from there. Null when `cwd` is in no repository, or git cannot say. */
export function invokingCheckout(cwd = process.cwd()) {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      const m = mainCheckoutOf(dir);
      return m.main ?? dir;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * The drift limb's verdict on the runner a corpus hook actually loaded — `runnerRoot`,
 * the repository root of the spec-guards.mjs that is running. Returns `{ code, lines }`:
 *   0  it is the pinned runner and it is current;
 *   1  a finding — a live checkout, a branch, edits, or not at RUNNER_REF;
 *   2  could not tell — no main checkout, no RUNNER_REF, or git refused.
 */
export function runnerDrift(runnerRoot) {
  const elected = mainCheckoutOf(runnerRoot);
  if (!elected.main) {
    return { code: 2, lines: [`the runner's main checkout could not be elected from ${runnerRoot}: ${elected.why}`] };
  }
  const pin = runnerDirOf(elected.main);
  if (!sameDir(runnerRoot, pin)) {
    let where;
    try {
      const b = branchOf(runnerRoot);
      where = b ? `a checkout on branch \`${b}\`` : `a checkout detached at ${short(repoGit(runnerRoot, 'rev-parse', 'HEAD').trim())}`;
    } catch (e) {
      if (!(e instanceof RepoGitError)) throw e;
      where = `a tree git could not read (${e.message})`;
    }
    const st = runnerState(elected.main);
    return { code: 1, lines: [
      `the corpus's hook loaded its runner from ${runnerRoot} — ${where} —`,
      `  not from the pinned runner ${pin}.`,
      '  Whatever that tree holds today is what judged this commit, not origin/main.',
      st.status === 'absent'
        ? `  Create the runner:  ${createRunnerCommand(elected.main)}`
        : `  The runner is here (${st.status}).`,
      `  Then point the corpus at it:  node ${slash(join(pin, 'tooling', 'scripts', 'install-hooks.mjs'))} --pin-private`,
    ] };
  }
  const st = runnerState(elected.main);
  if (st.status === 'current') return { code: 0, lines: [] };
  if (st.status === 'unreadable' || st.status === 'no-ref') {
    return { code: 2, lines: [`the pinned runner cannot be judged: ${st.status} — ${st.why}`] };
  }
  const fix = st.status === 'stale'
    ? `node ${slash(join(st.dir, 'tooling', 'scripts', 'install-hooks.mjs'))} --advance-runner   (the hooks do this themselves; this run did not)`
    : 'restore it to a clean, detached checkout of origin/main by hand — nothing here discards an edit or leaves a branch';
  return { code: 1, lines: [
    `the pinned runner is ${st.status}: ${st.why}.`,
    `  ${fix}`,
  ] };
}
