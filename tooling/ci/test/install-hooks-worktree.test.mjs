// ─────────────────────────────────────────────────────────────────────────────
// install-hooks-worktree.test.mjs — the private corpus is named after the MAIN
// CHECKOUT, so a run from a linked worktree finds it instead of reporting n/a.
//
// 🔴 THE DEFECT, AND WHY IT IS THE DANGEROUS KIND (O-INSTALL-HOOKS-NAMES-THE-
// CORPUS-AFTER-THE-WORKTREE). `install-hooks.mjs` derives the corpus from
// `basename(REPO)` — `…_Public` → `…_Private`, a sibling. In a LINKED WORKTREE
// `REPO` is the worktree, whose directory is named after the lane that created it
// (`.worktrees/zz-named-after-nothing`), so the derived sibling was
// `.worktrees/zz-named-after-nothing_Private`: a path that has never existed and
// never will. The script then took its ABSENCE branch, printed
// `n/a  private corpus  not in this checkout`, and EXITED 0.
//
// Exit 0 is the whole finding. The corpus's `core.hooksPath` is local config that
// no clone and no worktree carries, and this script is the only thing that repairs
// it; a run that cannot see the corpus reports a clean install of hooks it never
// looked at. It is the same vacuous pass the file's own header was written
// against — reached by a third door. Not a miscounted `..` this time, and not a
// missing anchor: a correct rule applied to the wrong tree. A worktree is a second
// working COPY of one repository, and the repository's name belongs to the
// checkout it was cloned into, not to each copy of it.
//
// ⚠️ THE FIXTURE IS A REAL REPOSITORY AND A REAL `git worktree add`, like
// `spec-guards-worktree.test.mjs` beside it. Nothing less exercises
// `git rev-parse --git-common-dir`, which is the only thing the fix rests on, and
// a mocked answer would prove the mock. The workspace layout is real too: the
// script ANCHORS on one directory holding both `Projects/` and `nikatru/`
// (`findWorkspaceAnchor`), and refuses with code 2 when it finds none — so the
// fixture lays out `<tmp>/Projects/` and `<tmp>/nikatru/` and puts the repos
// under the first.
//
// ⚠️ ASSERT ON THE TEXT, NOT ON THE EXIT CODE. `--check` exits 1 whenever
// `core.hooksPath` is unset, which it always is in a fresh fixture — broken and
// fixed alike. What separates them is whether the corpus was REACHED at all; the
// note above the cases sets out exactly which lines say so.
//
// The only repositories written to are the fixture's own, by the last case, which
// runs a real install and reads the corpus's config back. The first two cases pass
// `--check` and write nothing.
//
// Run:  node --test "tooling/ci/test/install-hooks-worktree.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // tooling/ci/test -> repo root
const SCRIPTS = join(REPO, 'tooling', 'scripts');

/** The worktree is named after NOTHING that exists, on purpose: the whole defect
 *  is that this name reached a path, and a name like `structure` reads plausibly
 *  enough that a failure could be mistaken for a real corpus. */
const LANE = 'zz-named-after-nothing';

let BASE;   // the throwaway workspace: holds Projects/ and nikatru/
let PUB;    // <BASE>/Projects/Acme_Public   — the MAIN checkout
let PRIV;   // <BASE>/Projects/Acme_Private  — the corpus
let WT;     // <BASE>/Projects/.worktrees/<LANE> — the linked worktree

const git = (where, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git -C ${where} ${args.join(' ')} -> ${r.status}\n${r.stderr}`);
  return r.stdout;
};

/** `git config --get` exits 1 for an UNSET key, which is data here and not a
 *  failure — so it gets its own reader rather than the asserting `git` above. */
const hooksPathOf = (where) => {
  const r = spawnSync('git', ['-C', where, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, `git config --get -> ${r.status}\n${r.stderr}`);
  return (r.stdout ?? '').trim();
};

const write = (abs, text) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text, 'utf8'); };

/** Run the copied script from `cwd` and hand back everything it printed.
 *  `shell: false`, so no argument is re-parsed by cmd.exe. */
function installHooks(cwd, ...args) {
  const r = spawnSync(process.execPath, [join(cwd, 'tooling', 'scripts', 'install-hooks.mjs'), ...args], {
    cwd, encoding: 'utf8', timeout: 60_000, env: process.env,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'install-hooks-wt-'));
  mkdirSync(join(BASE, 'nikatru'), { recursive: true });        // the second anchor marker
  PUB = join(BASE, 'Projects', 'Acme_Public');
  PRIV = join(BASE, 'Projects', 'Acme_Private');
  WT = join(BASE, 'Projects', '.worktrees', LANE);

  // ── the main checkout ──────────────────────────────────────────────────────
  mkdirSync(join(PUB, 'tooling', 'scripts'), { recursive: true });
  for (const f of ['install-hooks.mjs', 'repo-git.mjs']) {
    copyFileSync(join(SCRIPTS, f), join(PUB, 'tooling', 'scripts', f));
  }
  // Both hooks must EXIST or the script refuses with code 2 before it reaches the
  // corpus at all ("pointing a repo at an empty hooks directory installs silence").
  // They are never executed here: `--check` only reads config.
  for (const h of ['pre-commit', 'pre-push']) {
    write(join(PUB, '.githooks', h), '#!/bin/sh\nexit 0\n');
  }
  git(PUB, 'init', '-q', '-b', 'main');
  git(PUB, 'add', '-A');
  git(PUB, 'commit', '-q', '-m', 'fixture');

  // ── the corpus: a real repository with a real file, so it is neither absent
  //    nor one of the EMPTY pre-created shells the script refuses to accept ────
  mkdirSync(PRIV, { recursive: true });
  write(join(PRIV, 'README.md'), '# corpus\n');
  git(PRIV, 'init', '-q', '-b', 'main');
  git(PRIV, 'add', '-A');
  git(PRIV, 'commit', '-q', '-m', 'corpus');

  // ── the linked worktree: tracked files only, exactly as a real one ──────────
  git(PUB, 'worktree', 'add', '-q', '-b', LANE, WT);
});

after(() => {
  try { git(PUB, 'worktree', 'remove', '--force', WT); } catch { /* the rm below covers it */ }
  try { rmSync(BASE, { recursive: true, force: true }); } catch { /* Windows may hold a handle; temp litter is harmless */ }
});

/* ⚠️ WHAT THE OUTPUT DOES AND DOES NOT CONTAIN, since it decides every assertion
   below. The corpus's PATH is printed only by the absence branches; the reached
   branch prints the config read instead — `RED  private corpus  core.hooksPath =
   (unset)   want <relative path>`, and that relative path runs from the corpus to
   the hooks directory of the tree the script was launched from, so it names
   `Acme_Public` from the main checkout and the worktree from the worktree.
   The honest discriminator is therefore REACHED vs NOT REACHED, not a path match:
     fixed  → `RED  private corpus  core.hooksPath …`  and `2 repo(s) not installed.`
     broken → `n/a  private corpus  not in this checkout` and `1 repo(s) not installed.`
   Both exit 1, because the public repo's own hooksPath is unset in a fresh fixture
   either way. That is why no case here asserts a difference in the exit code. */
describe('install-hooks names the corpus after the main checkout, not after the tree it stands in', () => {
  test('from a LINKED WORKTREE the corpus is REACHED, not reported absent', () => {
    const r = installHooks(WT, '--check');

    // 🔴 THE ASSERTION. Before the fix this run derived
    // `.worktrees/zz-named-after-nothing_Private`, found nothing there, printed
    // `n/a  private corpus  not in this checkout` and called it a clean result.
    assert.doesNotMatch(r.out, new RegExp(`${LANE}_Private`), `the corpus was named after the WORKTREE:\n${r.out}`);
    assert.doesNotMatch(r.out, /not in this checkout/, `the corpus was reported absent from a worktree:\n${r.out}`);
    assert.match(r.out, /RED\s+private corpus\s+core\.hooksPath/, `the corpus's own config was never read:\n${r.out}`);
    assert.match(r.out, /2 repo\(s\) not installed\./, `only one repo was judged — the corpus was skipped:\n${r.out}`);
    // Exit 1 because hooksPath is unset in a fresh fixture, NOT because of the fix.
    assert.equal(r.code, 1, r.out);
  }, { timeout: 120_000 });

  test('the control: from the MAIN checkout the run is unchanged', () => {
    const r = installHooks(PUB, '--check');
    assert.doesNotMatch(r.out, /not in this checkout/, r.out);
    assert.match(r.out, /RED\s+private corpus\s+core\.hooksPath/, r.out);
    assert.match(r.out, /2 repo\(s\) not installed\./, r.out);
    assert.equal(r.code, 1, r.out);
  }, { timeout: 120_000 });

  // ⚠️ RUNS LAST AND MUTATES THE FIXTURE: this is the only case that installs.
  test('and the repair actually lands: a real run from the worktree SETS the corpus hooksPath', () => {
    const before = hooksPathOf(PRIV);
    assert.equal(before, '', 'the fixture corpus should start with no hooksPath, or this case proves nothing');

    const r = installHooks(WT);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SET\s+private corpus\s+core\.hooksPath/, r.out);

    // Read it back out of the OTHER repository, which is where the defect lived:
    // the config this script exists to repair is local to the corpus and no clone
    // or worktree carries it. Before the fix this stayed empty and the run still
    // exited 0.
    const after = hooksPathOf(PRIV);
    assert.notEqual(after, '', 'the corpus hooksPath is still unset: the run reported success without repairing anything');
    // 📍 It resolves INTO THE WORKTREE (`../.worktrees/<lane>/.githooks`), because
    // the value is `relative(corpus, <this tree>/.githooks)` and this tree is the
    // worktree. That is a separate, smaller hazard — a corpus pointed at hooks
    // that vanish when the lane is removed — and is deliberately NOT fixed here:
    // this row is about finding the corpus at all. Asserted, so that a later change
    // which makes the value main-checkout-relative shows up here as a decision
    // rather than as a surprise.
    assert.ok(existsSync(resolve(PRIV, after)), `the corpus was pointed at ${after}, which does not resolve to a directory that exists`);
    assert.match(after, new RegExp(LANE), `expected the value to still resolve into the worktree; it is now ${after} — if that was deliberate, update this case and the note above it`);
  }, { timeout: 120_000 });
});
