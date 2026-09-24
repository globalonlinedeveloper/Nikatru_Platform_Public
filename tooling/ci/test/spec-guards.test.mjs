// ─────────────────────────────────────────────────────────────────────────────
// spec-guards.test.mjs — the pre-commit runner's GUARDS table must still name
// every guard it claims to run, and the newest entry must actually be in it.
//
// 🔴 WHY THIS FILE EXISTS. `tooling/scripts/spec-guards.mjs` is the ONLY thing
// that runs the private corpus's guards: their subject is gitignored, so no CI
// job can read it and no CI job can notice one going missing from the table. The
// failure that produced this test is on record — `assert-platform-state.mjs` was
// written, documented in two READMEs, and wired into NOTHING for a day, so a
// mutated state file committed clean. A guard that is written and not wired is a
// guard nobody runs, and the absence is invisible from both sides: the guard
// still passes when invoked by hand, and the runner still prints "ok" over the
// set it does know about.
//
// ⚠️ THIS TEST DELIBERATELY DOES NOT SPAWN THE RUNNER. `spec-guards.mjs` exits 2
// when the private corpus is absent, and it is absent by construction in CI and
// in every fresh clone — so a test that ran it would be red in CI forever, which
// gets a suite deleted rather than fixed. What is checkable everywhere is the
// TABLE, which is source in this repo. The runner's own behaviour is proven by
// the pre-commit probe recorded with the change that added the entry: a mutated
// `platform-state` file made the commit exit 1, and reverting it made the same
// commit exit 0.
//
// ── EVERY CASE CARRIES ITS OWN MUTANT ────────────────────────────────────────
// A test that only reads the real source and finds what it expects is an
// assertion nobody has watched fail. So each case below runs the SAME predicate
// twice: once over the real file (must pass) and once over a mutated copy of its
// text with the subject removed (must fail). If a future edit makes the predicate
// unable to fail, the mutant half goes red and says so.
//
// ⏱ 2026-09-24 — THE CORPUS'S ROWS LEFT THE TABLE (O-GUARD-SET-DECLARED-NOWHERE).
// They are entries in the corpus's `requirements/tooling/guards.json`, read by
// `tooling/scripts/guard-declaration.mjs`, and the table keeps only the rows whose
// subject is public. So the first four cases below assert two things where they
// asserted one: the guard is in the loader's PINNED_HOOK, which is source in this
// repo, and the loader, run over a fixture declaration carrying the guard's exact
// file and args, hands the runner that rel and those args. The mutants are the same
// three: the row removed, the rel changed, `--check` dropped. The real declaration's
// content is the corpus's to check (`assert-guard-set`); what is checkable here is
// that the pin holds and the loader passes a declared row through unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLARATION_REL,
  GuardDeclarationError,
  PINNED_HOOK,
  loadGuardDeclaration,
} from '../../scripts/guard-declaration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // tooling/ci/test -> repo root
const RUNNER = resolve(REPO, 'tooling', 'scripts', 'spec-guards.mjs');
const SOURCE = readFileSync(RUNNER, 'utf8');

/* The table is read as source text rather than imported, because importing the
   runner RUNS it — it resolves the workspace anchor and exits at module scope. */
function guardsTable(src) {
  const start = src.indexOf('const GUARDS = [');
  assert.notEqual(start, -1, 'spec-guards.mjs no longer declares `const GUARDS = [` — this test is reading the wrong thing');
  const end = src.indexOf('\n];', start);
  assert.notEqual(end, -1, 'the GUARDS array is not terminated by a line starting `];` — parse assumption broken');
  return src.slice(start, end);
}

/* Each row is `{ name: '<guard>', speed: '<fast|slow>', needsPrivate: <bool>,` on
   one line, which is the shape every entry in the file uses today. Parsing that
   shape rather than eval-ing keeps the test free of the runner's side effects. */
function rowsOf(table) {
  const rows = [];
  const re = /\{\s*name:\s*'([^']+)',\s*speed:\s*'([^']+)',\s*needsPrivate:\s*(true|false),/g;
  let m;
  while ((m = re.exec(table)) !== null) rows.push({ name: m[1], speed: m[2], needsPrivate: m[3] === 'true' });
  return rows;
}

/* The mutant: the entry's own row line, deleted. Nothing else is touched, so a
   failure here means the predicate ranged over the row and not over the file. */
function withoutRow(src, name) {
  const line = src.split('\n').find((l) => l.includes(`{ name: '${name}'`));
  assert.ok(line, `cannot build the mutant — no row line for ${name}`);
  return src.split('\n').filter((l) => l !== line).join('\n');
}

/* The fixture declaration: the sixteen pinned guards with the file and args the real
   declaration gives each (Private requirements/tooling/guards.json, as measured
   2026-09-24), every one on both sides. Written out by hand, because a fixture computed
   from the pin would agree with the pin by construction. */
const FIXTURE_DECLARATION = [
  { id: 'assert-platform-state', file: 'requirements/tooling/assert-platform-state.mjs', hook: ['public', 'private'], args: [] },
  { id: 'assert-adr-citations', file: 'requirements/tooling/assert-adr-citations.mjs', hook: ['public', 'private'], args: [] },
  { id: 'assert-index-complete', file: 'requirements/tooling/assert-index-complete.mjs', hook: ['public', 'private'], args: [] },
  { id: 'assert-spec', file: 'requirements/tooling/assert-spec.mjs', hook: ['public', 'private'], args: [] },
  { id: 'assert-requirements-index', file: 'requirements/tooling/assert-requirements-index.mjs', hook: ['public', 'private'], args: [] },
  { id: 'assert-links', file: 'requirements/tooling/assert-links.mjs', hook: ['public', 'private'], args: ['--index'] },
  { id: 'check-agent-docs', file: 'requirements/tooling/check-agent-docs.mjs', hook: ['public', 'private'], args: ['--index'] },
  { id: 'assert-guard-set', file: 'requirements/tooling/assert-guard-set.mjs', hook: ['public', 'private'], args: ['--index'] },
  { id: 'gen-start-here', file: 'requirements/tooling/gen-start-here.mjs', hook: ['public', 'private'], args: ['--check'] },
  { id: 'gen-register-index', file: 'requirements/tooling/gen-register-index.mjs', hook: ['public', 'private'], args: ['--check'] },
  { id: 'gen-adr-frontmatter', file: 'requirements/tooling/gen-adr-frontmatter.mjs', hook: ['public', 'private'], args: ['--check'] },
  { id: 'gen-index', file: 'requirements/tooling/gen-index.mjs', hook: ['public', 'private'], args: ['--check'] },
  { id: 'gen-traps', file: 'requirements/tooling/gen-traps.mjs', hook: ['public', 'private'], args: ['--check'] },
  { id: 'gen-picture-stamp', file: 'requirements/tooling/gen-picture-stamp.mjs', hook: ['public', 'private'], args: ['--check'] },
  { id: 'check-dod-sync', file: 'tooling/scripts/check-dod-sync.mjs', hook: ['public', 'private'], args: [] },
  { id: 'assert-public-citations', file: 'tooling/scripts/assert-public-citations.mjs', hook: ['public', 'private'], args: [] },
];

/* One throwaway corpus per run of this file, re-committed per declaration. The loader
   reads a git BLOB, so a declaration it is handed has to be a commit. */
let DECL_BASE = null;
let DECL_REPO = null;
function declare(entries) {
  if (!DECL_REPO) {
    DECL_BASE = mkdtempSync(join(tmpdir(), 'spec-guards-decl-'));
    DECL_REPO = fixtureRepo(join(DECL_BASE, 'Fixture_Private'), 'marker', 1);
  }
  const abs = join(DECL_REPO, ...DECLARATION_REL.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
  const add = spawnSync('git', ['-C', DECL_REPO, 'add', '-A'], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  const commit = spawnSync('git', ['-C', DECL_REPO, 'commit', '-q', '--allow-empty', '-m', 'declaration', '--no-gpg-sign'], { encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);
  return loadGuardDeclaration(DECL_REPO, 'public');
}
after(() => { if (DECL_BASE) rmSync(DECL_BASE, { recursive: true, force: true }); });

/** The runner row the loader hands over for `name`, or null when the loader refuses
 *  the declaration or does not select the guard. A refusal is null, not a throw: each
 *  predicate below must be able to answer "no" to a mutant. */
function loadedRow(entries, name) {
  try {
    return declare(entries).rows.find((r) => r.name === name) ?? null;
  } catch (e) {
    if (e instanceof GuardDeclarationError) return null;
    throw e;
  }
}

const withoutEntry = (entries, name) => entries.filter((e) => e.id !== name);
const withEntry = (entries, name, patch) => entries.map((e) => (e.id === name ? { ...e, ...patch } : e));

/* The runner must still READ the declaration: a runner that stopped importing or
   calling the loader would run the two static rows and print ok. */
const RUNNER_LOADS = (src) => /from '\.\/guard-declaration\.mjs'/.test(src) && /loadGuardDeclaration\(PRIVATE_ROOT, SIDE\)/.test(src);

test('the runner still declares a parseable GUARDS table', () => {
  const rows = rowsOf(guardsTable(SOURCE));
  // RE-BASED 7 -> static 2 + PINNED_HOOK 16 on 2026-09-24: the fifteen corpus rows left the table for the corpus's declaration (O-GUARD-SET-DECLARED-NOWHERE). Measured on the day: the table parses 2 rows (assert-name-clearance, assert-release-json) and the pin names 16 (the fifteen, plus assert-guard-set).
  assert.ok(rows.length >= 2, `expected at least 2 static guard rows, parsed ${rows.length} — the row shape changed and every case below is reading nothing`);
  assert.ok(PINNED_HOOK.length >= 16, `expected at least 16 pinned guards, found ${PINNED_HOOK.length} — a guard left the hook with no reviewed edit here`);
  assert.equal(RUNNER_LOADS(SOURCE), true, 'spec-guards.mjs no longer imports and calls loadGuardDeclaration — the corpus\'s guards would run from no list');

  // MUTANT — a static row deleted is seen by the parse, and a runner that no longer
  // imports the loader is seen by the load check.
  assert.equal(rowsOf(guardsTable(withoutRow(SOURCE, 'assert-release-json'))).length, rows.length - 1, 'the parse does not see a deleted row, so the floor above reads nothing');
  assert.equal(RUNNER_LOADS(SOURCE.replace("from './guard-declaration.mjs'", "from './nothing.mjs'")), false, 'the loader check cannot fail');
});

test('assert-platform-state is wired into the runner, and the check can fail', () => {
  const NAME = 'assert-platform-state';

  assert.ok(PINNED_HOOK.includes(NAME), `${NAME} is not in PINNED_HOOK — the guard exists and a declaration may drop it unseen`);
  const row = loadedRow(FIXTURE_DECLARATION, NAME);
  assert.ok(row, `the loader did not hand ${NAME} to the runner from a declaration that names it`);
  assert.equal(row.needsPrivate, true, `${NAME}'s subject is the private corpus, so needsPrivate must be true`);
  assert.equal(row.speed, 'fast', `${NAME} is a schema validation over eight files; it belongs in the pre-commit set`);

  // MUTANT — the same predicate over a declaration with the row deleted MUST fail,
  // and over a pin list without the name.
  assert.equal(loadedRow(withoutEntry(FIXTURE_DECLARATION, NAME), NAME), null, 'the loader still hands over the row it was not given — this assertion cannot fail and is worse than none');
  assert.equal(PINNED_HOOK.filter((n) => n !== NAME).includes(NAME), false, 'the membership check cannot fail');
});

test('the runner names the guard by a corpus-relative path that a locate() candidate can join', () => {
  const NAME = 'assert-platform-state';
  const REL = 'requirements/tooling/assert-platform-state.mjs';
  const relOk = (row) => row !== null && row.rel.length === 1 && row.rel[0] === REL;
  assert.equal(
    relOk(loadedRow(FIXTURE_DECLARATION, NAME)),
    true,
    'the rel candidate must be corpus-relative and un-prefixed; `locate()` joins it onto the resolved corpus root, and an absolute or repo-relative spelling resolves nowhere',
  );
  assert.match(SOURCE, /path: locate\(\.\.\.g\.rel\)/, 'the runner no longer resolves a row by joining its rel through locate()');

  // MUTANT — a declaration whose file no longer names the guard must be caught.
  const moved = withEntry(FIXTURE_DECLARATION, NAME, { file: 'requirements/tooling/does-not-exist.mjs' });
  assert.equal(relOk(loadedRow(moved, NAME)), false, 'the mutant still matches — the predicate is not reading the rel');
});

/* ADDED 2026-09-16. The corpus's six generators joined the table, and each is only a
   check when it is invoked with `--check` — without the flag four of them WRITE their
   target. So the row must exist, be fast and private, name the corpus-relative
   generator, and carry `args: ['--check']`. Measured the day they were added:
   gen-start-here --check exited 1 on the committed corpus while this runner exited 0.
   ⏱ 2026-09-24: "the row" is now a PINNED_HOOK name plus a declared entry the loader
   passes through; the three mutants are unchanged in meaning. */
const PRIVATE_GENERATORS = ['gen-adr-frontmatter', 'gen-index', 'gen-picture-stamp', 'gen-register-index', 'gen-start-here', 'gen-traps'];

function generatorRowOk(entries, name, pinned = PINNED_HOOK) {
  if (!pinned.includes(name)) return false;
  const row = loadedRow(entries, name);
  if (!row || row.speed !== 'fast' || row.needsPrivate !== true) return false;
  return row.rel.length === 1 && row.rel[0] === `requirements/tooling/${name}.mjs`
    && row.args.length === 1 && row.args[0] === '--check';
}

test('every private generator runs in the hook, as --check, from its corpus-relative path', () => {
  for (const name of PRIVATE_GENERATORS) {
    assert.ok(generatorRowOk(FIXTURE_DECLARATION, name), `${name} is missing from PINNED_HOOK, or the loader does not hand it over fast/needsPrivate, or it does not run as \`--check\` from requirements/tooling/${name}.mjs`);

    // MUTANT 1 — the row deleted: from the declaration, and from the pin.
    assert.equal(generatorRowOk(withoutEntry(FIXTURE_DECLARATION, name), name), false, `deleting the ${name} entry still passes — the predicate cannot fail`);
    assert.equal(generatorRowOk(FIXTURE_DECLARATION, name, PINNED_HOOK.filter((n) => n !== name)), false, `unpinning ${name} still passes — the predicate cannot fail`);
    // MUTANT 2 — the rel changed.
    assert.equal(generatorRowOk(withEntry(FIXTURE_DECLARATION, name, { file: `requirements/tooling/${name}-moved.mjs` }), name), false, `moving ${name}'s file still passes — the predicate is not reading the rel`);
    // MUTANT 3 — the row kept, the flag dropped: the generator would WRITE its target.
    assert.equal(generatorRowOk(withEntry(FIXTURE_DECLARATION, name, { args: [] }), name), false, `dropping --check from ${name} still passes — a writing generator would read as a check`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDED 2026-09-07 — `tooling/scripts/repo-git.mjs`, and the defect it closes.
//
// 🔴 Git EXPORTS `GIT_DIR` into every hook process and can export `GIT_INDEX_FILE`
// with it, and those variables BEAT `git -C <other repo>`. Both this repo and the
// private corpus are pointed at this repo's `.githooks/`, so `assert-public-
// citations.mjs` — which the GUARDS table above runs — executed inside PRIVATE
// commits and enumerated the PRIVATE index while pointed at the PUBLIC work tree:
// 567 files against this tree's 2022, below its `FILE_FLOOR` of 800, so it refused
// in 170 ms and private commits were being overridden with `--no-verify`.
//
// ⚠️ THE MUTANT HERE IS THE ENVIRONMENT, NOT A TEXT EDIT. The cases below build two
// throwaway repositories and read one of them while the environment insists on the
// other; the "must fail" half of each case is a `spawnSync('git', …)` WITHOUT the
// helper over the identical arguments, which must answer about the wrong repository.
// If a future edit stops the helper from deleting the variables, the two halves
// agree and the case goes red. A source-text assertion could not do that: the whole
// defect is that the source looked right.
//
// These are the only cases in this file that spawn anything, and they are cheap —
// two `git init`s in a temp directory, no network, no corpus. They run everywhere,
// including in CI where the private corpus is absent by construction.
// ⏱ 2026-09-24: no longer the only ones — the four cases above commit their fixture
// declarations into one throwaway repository through `fixtureRepo` below, for the
// same reason: the loader reads a git blob. Still no network and no corpus.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GIT_REDIRECTING_VARS,
  RepoGitError,
  assertRepoRoot,
  cleanGitEnv,
  repoGit,
  strippedGitVars,
} from '../../scripts/repo-git.mjs';

/** A repository with `n` distinct tracked files, committed, so `ls-files` has a
 *  count that identifies WHICH repository answered. */
function fixtureRepo(where, prefix, n) {
  mkdirSync(where, { recursive: true });
  const g = (...args) => {
    const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  };
  g('init', '-q');
  g('config', 'user.email', 'fixture@example.test');
  g('config', 'user.name', 'fixture');
  g('config', 'commit.gpgsign', 'false');
  for (let i = 0; i < n; i += 1) writeFileSync(join(where, `${prefix}-${i}.txt`), `${prefix}\n`);
  g('add', '-A');
  g('commit', '-q', '-m', 'fixture', '--no-gpg-sign');
  return where;
}

/** Run `fn` with `extra` layered onto `process.env`, restored afterwards even on a
 *  throw. Layering rather than replacing, because PATH must survive — "git is
 *  genuinely absent" is a separate case below and must not arrive by accident. */
function withEnv(extra, fn) {
  const saved = new Map();
  for (const [k, v] of Object.entries(extra)) {
    saved.set(k, Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const countOf = (out) => out.split('\n').map((s) => s.trim()).filter(Boolean).length;

test('repo-git: a poisoned GIT_DIR + GIT_INDEX_FILE cannot redirect the read, and the unguarded spawn proves it could', () => {
  const base = mkdtempSync(join(tmpdir(), 'repo-git-poison-'));
  try {
    const A = fixtureRepo(join(base, 'A'), 'a', 3);   // the repo we mean
    const B = fixtureRepo(join(base, 'B'), 'b', 7);   // the repo the environment names
    const poison = { GIT_DIR: join(B, '.git'), GIT_INDEX_FILE: join(B, '.git', 'index') };

    withEnv(poison, () => {
      assert.equal(countOf(repoGit(A, 'ls-files')), 3, 'the helper answered about the WRONG repository — the whole point of the module is that it cannot');

      // MUTANT — the same read WITHOUT the helper. It must answer about B, or this
      // case is not exercising anything and the leak it guards is unreachable here.
      const raw = spawnSync('git', ['-C', A, 'ls-files'], { encoding: 'utf8' });
      assert.equal(raw.status, 0, `unguarded control failed to run: ${raw.stderr}`);
      assert.equal(countOf(raw.stdout), 7, 'the unguarded `git -C A ls-files` did NOT read B, so this environment does not reproduce the defect and the assertion above proves nothing');
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('repo-git: all six redirecting variables at nonexistent paths change nothing', () => {
  const base = mkdtempSync(join(tmpdir(), 'repo-git-six-'));
  try {
    const A = fixtureRepo(join(base, 'A'), 'a', 4);
    const nowhere = join(base, 'no-such-9f2a');
    const poison = {
      GIT_DIR: join(nowhere, '.git'),
      GIT_WORK_TREE: nowhere,
      GIT_INDEX_FILE: join(nowhere, 'index'),
      GIT_PREFIX: 'zz/',
      GIT_COMMON_DIR: join(nowhere, 'common'),
      GIT_OBJECT_DIRECTORY: join(nowhere, 'objects'),
    };
    assert.equal(GIT_REDIRECTING_VARS.length, 6, 'the module no longer strips six variables; a door has been reopened');
    for (const name of GIT_REDIRECTING_VARS) {
      assert.ok(Object.prototype.hasOwnProperty.call(poison, name), `${name} is stripped by the module but this case does not set it, so the case under-tests the module`);
    }

    withEnv(poison, () => {
      assert.deepEqual(strippedGitVars(), [...GIT_REDIRECTING_VARS], 'the case did not actually set all six');
      const { env, stripped } = cleanGitEnv();
      assert.equal(stripped.length, 6, 'cleanGitEnv reported stripping fewer than six');
      for (const name of GIT_REDIRECTING_VARS) {
        assert.equal(Object.prototype.hasOwnProperty.call(env, name), false, `${name} survived into the child environment — BLANKING is not deleting, and git reads GIT_DIR="" as the current directory`);
      }
      assert.ok(env.PATH || env.Path || env.path, 'PATH was dropped from the child environment; "git is absent" must stay reachable and must stay a refusal');
      assert.equal(countOf(repoGit(A, 'ls-files')), 4);

      // MUTANT — unguarded, the same read cannot even run.
      const raw = spawnSync('git', ['-C', A, 'ls-files'], { encoding: 'utf8' });
      assert.notEqual(raw.status, 0, 'the unguarded control succeeded, so the six variables were not actually poisoning anything');
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('repo-git: a root that is not its own repository root is a refusal, not an answer about the enclosing repo', () => {
  const base = mkdtempSync(join(tmpdir(), 'repo-git-top-'));
  try {
    const A = fixtureRepo(join(base, 'A'), 'a', 3);
    const inner = join(A, 'sub');
    mkdirSync(inner, { recursive: true });

    assert.throws(
      () => assertRepoRoot(inner),
      (e) => e instanceof RepoGitError && e.kind === 'toplevel' && /NOT this root/.test(e.message),
      'a subdirectory was accepted as a repository root — the limb that catches "this is not the repository I think it is" is gone',
    );
    assert.throws(() => repoGit(inner, 'ls-files'), RepoGitError, 'repoGit read a non-root without refusing');

    // MUTANT — unguarded, git answers happily about the ENCLOSING repository rather
    // than refusing, which is the silently-wrong answer this limb exists to catch.
    // The probe is `rev-parse`, not `ls-files`: `ls-files` in a subdirectory lists
    // only what is BELOW it, so an empty subdirectory would look like a refusal
    // while actually being a successful read of the wrong repository.
    const raw = spawnSync('git', ['-C', inner, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    assert.equal(raw.status, 0, 'the unguarded control failed outright, so this case is not exercising the limb');
    assert.notEqual(raw.stdout.trim(), '', 'the unguarded control returned no toplevel at all');
    assert.notEqual(
      raw.stdout.trim().replace(/\\/g, '/').toLowerCase(),
      inner.replace(/\\/g, '/').toLowerCase(),
      'git reported the subdirectory AS the toplevel, so there is no walk-up to refuse here and the assertions above prove nothing',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('repo-git: git absent from PATH is a refusal and never an empty subject', () => {
  const base = mkdtempSync(join(tmpdir(), 'repo-git-nopath-'));
  try {
    const A = fixtureRepo(join(base, 'A'), 'a', 2);
    const emptyDir = join(base, 'empty-bin');
    mkdirSync(emptyDir, { recursive: true });
    // Windows resolves PATH case-insensitively and node exposes whichever spelling
    // the process was given, so every spelling present is overwritten — leaving one
    // behind would leave git findable and the case would silently pass over nothing.
    const blanked = {};
    for (const k of Object.keys(process.env)) if (/^path$/i.test(k)) blanked[k] = emptyDir;
    assert.ok(Object.keys(blanked).length > 0, 'no PATH variable found to blank; this case would not be testing anything');

    withEnv(blanked, () => {
      assert.throws(
        () => repoGit(A, 'ls-files'),
        (e) => e instanceof RepoGitError && e.kind === 'spawn',
        'git being absent did not raise a spawn refusal — the alternative is an empty subject list, which passes every floor it is fed to',
      );
    });

    // The control: with PATH restored the same call answers, so the refusal above
    // was about git being absent and not about the fixture being broken.
    assert.equal(countOf(repoGit(A, 'ls-files')), 2);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the two tooling/scripts guards that read a repository no longer spawn git themselves', () => {
  for (const rel of ['tooling/scripts/assert-public-citations.mjs', 'tooling/scripts/install-hooks.mjs']) {
    const src = readFileSync(resolve(REPO, rel), 'utf8');
    assert.match(src, /from '\.\/repo-git\.mjs'/, `${rel} does not import the helper, so its git reads depend on the caller's environment again`);
    const spawnsGit = /spawnSync\(\s*'git'|execFileSync\(\s*'git'/.test(src);
    assert.equal(spawnsGit, false, `${rel} spawns git directly again — every such spawn inherits GIT_DIR/GIT_INDEX_FILE from the hook that invoked it`);

    // MUTANT — the predicate must be able to see a direct spawn.
    assert.equal(/spawnSync\(\s*'git'|execFileSync\(\s*'git'/.test(`${src}\nspawnSync('git', ['-C', X, 'ls-files']);`), true, 'the matcher cannot see a direct git spawn and is asserting nothing');
  }
});
