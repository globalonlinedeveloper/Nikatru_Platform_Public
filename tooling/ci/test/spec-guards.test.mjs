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
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('the runner still declares a parseable GUARDS table', () => {
  const rows = rowsOf(guardsTable(SOURCE));
  // RE-BASED 9 -> 7 on 2026-09-08: three rows retired with their subjects (assert-session-index, assert-research-archive, assert-plans-archive), so the runner declares 7 and a floor of 9 would refuse on a complete read.
  assert.ok(rows.length >= 7, `expected at least 7 guard rows, parsed ${rows.length} — the row shape changed and every case below is reading nothing`);
});

test('assert-platform-state is wired into the runner, and the check can fail', () => {
  const NAME = 'assert-platform-state';

  const rows = rowsOf(guardsTable(SOURCE));
  const row = rows.find((r) => r.name === NAME);
  assert.ok(row, `${NAME} is not in the GUARDS table — the guard exists and nothing runs it`);
  assert.equal(row.needsPrivate, true, `${NAME}'s subject is the private corpus, so needsPrivate must be true`);
  assert.equal(row.speed, 'fast', `${NAME} is a schema validation over eight files; it belongs in the pre-commit set`);

  // MUTANT — the same predicate over a copy with the row deleted MUST fail.
  const mutantRows = rowsOf(guardsTable(withoutRow(SOURCE, NAME)));
  assert.equal(mutantRows.find((r) => r.name === NAME), undefined, 'the mutant still finds the row — this assertion cannot fail and is worse than none');
});

test('the runner names the guard by a corpus-relative path that a locate() candidate can join', () => {
  const NAME = 'assert-platform-state';
  const table = guardsTable(SOURCE);
  const at = table.indexOf(`{ name: '${NAME}'`);
  assert.notEqual(at, -1, `${NAME} row not found`);
  const entry = table.slice(at, at + 400);
  assert.match(
    entry,
    /rel:\s*\[\s*'requirements\/tooling\/assert-platform-state\.mjs'/,
    'the rel candidate must be corpus-relative and un-prefixed; `locate()` joins it onto the resolved corpus root, and an absolute or repo-relative spelling resolves nowhere',
  );

  // MUTANT — a rel list that no longer names the guard must be caught.
  const mutant = entry.replace('requirements/tooling/assert-platform-state.mjs', 'requirements/tooling/does-not-exist.mjs');
  assert.doesNotMatch(mutant, /rel:\s*\[\s*'requirements\/tooling\/assert-platform-state\.mjs'/, 'the mutant still matches — the pattern is not reading the rel list');
});

/* ADDED 2026-09-16. The corpus's six generators joined the table, and each is only a
   check when it is invoked with `--check` — without the flag four of them WRITE their
   target. So the row must exist, be fast and private, name the corpus-relative
   generator, and carry `args: ['--check']`. Measured the day they were added:
   gen-start-here --check exited 1 on the committed corpus while this runner exited 0. */
const PRIVATE_GENERATORS = ['gen-adr-frontmatter', 'gen-index', 'gen-picture-stamp', 'gen-register-index', 'gen-start-here', 'gen-traps'];

function generatorRowOk(src, name) {
  const table = guardsTable(src);
  const row = rowsOf(table).find((r) => r.name === name);
  if (!row || row.speed !== 'fast' || row.needsPrivate !== true) return false;
  const at = table.indexOf(`{ name: '${name}'`);
  const next = table.indexOf('{ name:', at + 1);
  const entry = table.slice(at, next === -1 ? undefined : next);
  return new RegExp(`rel:\\s*\\[\\s*'requirements/tooling/${name}\\.mjs'\\s*\\]`).test(entry)
    && /args:\s*\[\s*'--check'\s*\]/.test(entry);
}

test('every private generator runs in the hook, as --check, from its corpus-relative path', () => {
  for (const name of PRIVATE_GENERATORS) {
    assert.ok(generatorRowOk(SOURCE, name), `${name} is missing from the GUARDS table, or is not fast/needsPrivate, or does not run as \`--check\` from requirements/tooling/${name}.mjs`);

    // MUTANT 1 — the row deleted.
    assert.equal(generatorRowOk(withoutRow(SOURCE, name), name), false, `deleting the ${name} row still passes — the predicate cannot fail`);
    // MUTANT 2 — the row kept, the flag dropped: the generator would WRITE its target.
    const at = SOURCE.indexOf(`{ name: '${name}'`);
    const flagAt = SOURCE.indexOf("args: ['--check']", at);
    const dropped = SOURCE.slice(0, flagAt) + 'args: []' + SOURCE.slice(flagAt + "args: ['--check']".length);
    assert.equal(generatorRowOk(dropped, name), false, `dropping --check from ${name} still passes — a writing generator would read as a check`);
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
