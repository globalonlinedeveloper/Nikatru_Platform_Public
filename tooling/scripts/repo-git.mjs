// ─────────────────────────────────────────────────────────────────────────────
// repo-git.mjs — the ONE place any script in this tree spawns `git` for a
// repository that is not the one the process happens to be standing in.
//
// 🔴 WHY THIS FILE EXISTS: `git -C <other repo>` IS NOT ENOUGH INSIDE A GIT HOOK.
//
// **Git EXPORTS `GIT_DIR` into every hook process**, and exports or can export
// `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_PREFIX`, `GIT_COMMON_DIR` and
// `GIT_OBJECT_DIRECTORY` with it. Those variables **BEAT `-C`**: `-C` only changes
// the directory git starts looking from, while `GIT_DIR` / `GIT_INDEX_FILE` say
// outright which repository and which index to use. `spawnSync(process.execPath,
// [guard])` in `tooling/scripts/spec-guards.mjs` inherits the whole environment and
// the guard spawning `git` inherits it again, so a guard invoked from one repo hook
// reads THAT repo while pointed at another one work tree.
//
// MEASURED 2026-09-07, in this repo, on `assert-public-citations.mjs` — which runs
// in the pre-commit hook of BOTH this repo and the private corpus, because both are
// pointed at this repo `.githooks/` directory:
//
//     git -C <public repo> ls-files | wc -l                                  2022
//     GIT_INDEX_FILE=<private>/.git/index git -C <public repo> ls-files | wc -l
//                                                                             567
//
// 567 is below that guard FILE_FLOOR of 800, so every private commit on this
// machine hit `only 567 tracked file(s) — below the floor of 800` in 170 ms against
// a real scan of seven seconds, and agents overrode the hook to get work in. The
// floor is the guard WORKING: a truncated subject list would have passed every
// assertion below it. What was broken was the subject, not the tree.
//
// This is the second half of one defect. The first half was its mirror image — the
// PRIVATE corpus guards reading the PUBLIC index from inside this repo hooks — and
// it was fixed the same day by `Private/requirements/tooling/corpus-git.mjs`, whose
// shape this file deliberately repeats. The two trees are separate repositories and
// the public tree must stand alone, so this is a SIBLING of that module and never an
// import of it.
//
// ⚠️ A `--show-toplevel` CHECK ALONE DOES NOT CATCH THIS. A bare `GIT_DIR` with no
// `GIT_WORK_TREE` leaves the work tree defaulting to the process directory, so
// `git -C <root> rev-parse --show-toplevel` answers with `<root>` — correct-looking
// — while `ls-files` reads the OTHER repository index. The assertion below is still
// carried, because it catches the case it was written for (a root that stopped being
// a repository of its own, or a stray parent repository above it), but it is carried
// IN ADDITION to deleting the variables, never instead of it.
//
// 🔴 THE RULE THIS FILE ENCODES: **A SCRIPT MUST NOT DEPEND ON THE CALLER
// ENVIRONMENT AT ALL.** Not "must survive the environment a hook happens to set
// today" — a hook that starts exporting one more variable next year would reopen
// this by a different door. The six variables below are DELETED from the child
// environment. Everything else (PATH above all, so that "git is genuinely absent"
// stays reachable and stays a refusal) is passed through untouched.
//
// ⚠️ THIS IS NOT A WEAKENING, AND THE SHAPE OF THE CHANGE IS THE ARGUMENT: it
// REMOVES an inherited variable. No floor moves, no limb is deleted, no exit code
// becomes friendlier. The callers check strictly more than they did, because before
// this they could not run under a hook at all.
//
// This module has NO main and terminates nothing — it THROWS, and every caller
// catches into its own COVERAGE LOST limb, code 2. "I could not run" and "it passed"
// are different sentences and must not share a code, and the caller is the only
// thing that knows which of its limbs a failure belongs to.
//
// Evidence, site list, mutation table and both hook proofs:
//   Private/pre-prune-2026-09-08:research/revamp-2026-09-05/fix-cross-repo-git-env-2026-09-07.md
// The private half of the same defect:
//   Private/pre-prune-2026-09-08:research/revamp-2026-09-05/fix-index-guards-gitdir-2026-09-07.md
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';

/** Every environment variable by which a CALLER can redirect `git` at a different
 *  repository, in the order the git documentation lists them. `GIT_DIR` is the one
 *  git itself exports into hooks; `GIT_INDEX_FILE` is the one measured doing the
 *  damage here. The other four are present because the rule is "the caller
 *  environment does not reach the repository under test", not "the two variables we
 *  were bitten by do not". */
export const GIT_REDIRECTING_VARS = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
]);

/** A copy of `process.env` with every redirecting variable DELETED — deleted, not
 *  blanked: git reads `GIT_DIR=""` as "the current directory", which is a third
 *  wrong answer rather than no answer. Returns `{ env, stripped }`; nothing depends
 *  on `stripped` being non-empty, because the normal case is a plain shell where
 *  none of them is set. */
export function cleanGitEnv(source = process.env) {
  const env = { ...source };
  const stripped = [];
  for (const name of GIT_REDIRECTING_VARS) {
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      stripped.push(`${name}=${env[name]}`);
      delete env[name];
    }
  }
  return { env, stripped };
}

/** The names only, for a refusal that wants to print what it ignored. */
export function strippedGitVars(source = process.env) {
  return GIT_REDIRECTING_VARS.filter((n) => Object.prototype.hasOwnProperty.call(source, n));
}

/** A one-line note naming the redirecting variables this process was handed, for the
 *  tail of a refusal. It says "none set" rather than nothing at all, so a reader of a
 *  refusal never has to wonder whether the check ran. */
export function strippedNote(source = process.env) {
  const names = strippedGitVars(source);
  return `(Redirecting GIT_* variables removed from the child environment: ${names.length ? names.join(', ') : 'none set'}.)`;
}

/** Thrown by everything below. `kind` is one of:
 *    'spawn'     — git could not be started at all (absent from PATH, ENOENT).
 *    'toplevel'  — git ran, and the repository at `root` is not rooted AT `root`.
 *    'status'    — git ran and exited non-zero on a command whose non-zero status the
 *                  caller did not declare readable.
 *  Every caller maps all three onto its own COVERAGE LOST limb, code 2. */
export class RepoGitError extends Error {
  constructor(kind, message, detail = '') {
    super(message);
    this.name = 'RepoGitError';
    this.kind = kind;
    this.detail = detail;
  }
}

/* Windows answers `--show-toplevel` with forward slashes and whichever drive-letter
   case git found, which is not byte-identical to what `path.resolve` produces for the
   same directory. Compare the SHAPE, not the bytes: separators normalised, a trailing
   separator dropped, and case folded only where the platform is case-insensitive.
   🔴 AND CANONICALISED FIRST, which is not belt-and-braces on Windows: `os.tmpdir()`
   on this machine answers in the 8.3 SHORT form (`C:\Users\LOCALU~1\AppData\…`) while
   git answers with the long one, so two spellings of ONE directory compared unequal
   and every temp-rooted caller — every fixture in the suite — refused a root that was
   perfectly correct. `realpathSync.native` is the only thing that reconciles them; it
   also collapses a directory symlink, which is how the corpus is reached in an agent
   worktree. It throws on a path that does not exist, and that case falls back to the
   textual form rather than being swallowed: a nonexistent root is a real refusal and
   must reach one, not disappear into an exception here. */
const sameDir = (a, b) => {
  const norm = (p) => {
    let s = resolve(String(p));
    try { s = realpathSync.native(s); } catch { /* not on disk — compare textually */ }
    s = s.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  return norm(a) === norm(b);
};

/** Roots already proven to be their own git toplevel, so the extra `rev-parse` is
 *  paid once per root per process rather than once per command. Keyed on the
 *  normalised path. A root that FAILED is not cached: the caller is probably about to
 *  refuse, and re-reading is cheaper than remembering a failure wrongly. */
const provenRoots = new Set();

/** Assert that `root` is the ROOT of the git repository containing it — not merely
 *  somewhere inside one. Throws `RepoGitError` otherwise.
 *
 *  This is the limb that catches "the directory I was handed is not the repository I
 *  think it is": a corpus that stopped being its own checkout, a slot directory that
 *  is really a subdirectory of some enclosing repository, a temp root with no git in
 *  it at all. It is NOT what catches the inherited-variable defect — the deletion
 *  above is — and the header says why it cannot be. */
export function assertRepoRoot(root) {
  const key = process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root);
  if (provenRoots.has(key)) return;
  const { env } = cleanGitEnv();
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) {
    throw new RepoGitError(
      'spawn',
      `\`git\` could not be run against ${root}, so which repository would answer is unknown.`,
      `${r.error.message}\n  ${strippedNote()}`,
    );
  }
  if (r.status !== 0) {
    throw new RepoGitError(
      'toplevel',
      `there is no git repository rooted at ${root}.`,
      `${(r.stderr || '').trim()}\n  ${strippedNote()}`,
    );
  }
  const top = (r.stdout || '').trim();
  if (!sameDir(top, root)) {
    throw new RepoGitError(
      'toplevel',
      'the git repository above this root is NOT this root.',
      `intended root       : ${root}\n  git --show-toplevel : ${top}\n  ${strippedNote()}`,
    );
  }
  provenRoots.add(key);
}

/** Run `git -C <root> <args…>` and return the raw spawn result, so a caller that
 *  reads a non-zero status as DATA (`git grep` exits 1 for "no match",
 *  `git remote get-url` exits non-zero for "no such remote") can keep doing that.
 *
 *  What it does not leave to the caller: the six redirecting variables are gone from
 *  the child environment, `cwd` is pinned to the root as well as `-C` (so no relative
 *  pathspec can resolve against a hook inherited directory), and `root` has been
 *  proven to BE the repository root before a single answer is read.
 *
 *  Throws `RepoGitError` for the two states that are not data: git absent, and a root
 *  that is not its own repository. */
export function repoGitRaw(root, args, options = {}) {
  assertRepoRoot(root);
  const { env } = cleanGitEnv();
  const r = spawnSync('git', ['-C', root, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (r.error) {
    throw new RepoGitError(
      'spawn',
      `\`git ${args.join(' ')}\` could not be started in ${root}.`,
      `${r.error.message}\n  ${strippedNote()}`,
    );
  }
  return r;
}

/** `repoGitRaw` for the ordinary case: a non-zero status is a failure and stdout is
 *  the answer. THROWS rather than returning an empty string — a swallowed error here
 *  becomes an empty subject list, which is the vacuous pass every floor in this tree
 *  exists to refuse. */
export function repoGit(root, ...args) {
  const r = repoGitRaw(root, args);
  if (r.status !== 0) {
    throw new RepoGitError(
      'status',
      `\`git ${args.join(' ')}\` exited ${r.status} in ${root}.`,
      `${(r.stderr || '').trim()}\n  ${strippedNote()}`,
    );
  }
  return r.stdout;
}

/** The MAIN checkout of the repository `root` belongs to: the parent of
 *  `git rev-parse --git-common-dir` when that answer is a `.git` DIRECTORY. In a
 *  main checkout that is `root` itself, so a caller that elects with this changes
 *  nothing outside a worktree; in a LINKED worktree it is the checkout the worktree
 *  was added from, whose name is the one the workspace is laid out under.
 *
 *  ⏱ 2026-09-22 (O-INSTALL-HOOKS-NAMES-THE-CORPUS-AFTER-THE-WORKTREE). A caller
 *  that derives a SIBLING path from `basename(root)` derives it from the worktree's
 *  own throwaway name inside a worktree — `.worktrees/<lane>_Private`, which never
 *  exists — and an "absent" branch below that then passes vacuously. The name of the
 *  checkout is not a property of the tree you are standing in.
 *
 *  Returns `{ main, why }` and NEVER throws for a git refusal: `why` carries the
 *  sentence a caller prints beside its fallback, so falling back is never silent.
 *  A non-git error still throws, because that is not a refusal.
 *
 *  ⚠️ In a linked worktree `--git-common-dir` answers with a RELATIVE path
 *  (`../..`-style) often enough that resolving it against `root` is not optional.
 *  A `.git` FILE (the worktree's own pointer) is never the common dir, and a bare
 *  repository's common dir is not named `.git` at all — both of those answer
 *  `{ main: null }` rather than a confident wrong directory.
 *
 *  Same rule as `spec-guards.mjs` `mainWorktreeOf`, `preflight.mjs` and
 *  `tooling/store/rehearse-capture-locally.mjs`, which each carry their own copy.
 *  Those three should import this one in a follow-up; they are deliberately NOT
 *  touched here, so that this change is readable on its own. */
export function mainCheckoutOf(root) {
  let out;
  try {
    out = repoGit(root, 'rev-parse', '--git-common-dir').trim();
  } catch (e) {
    if (e instanceof RepoGitError) return { main: null, why: e.message };
    throw e;
  }
  if (!out) return { main: null, why: '`git rev-parse --git-common-dir` printed nothing' };
  const common = resolve(root, out);
  if (basename(common) !== '.git') return { main: null, why: `the git common dir is ${common}, which is not a \`.git\` directory` };
  return { main: dirname(common), why: null };
}
