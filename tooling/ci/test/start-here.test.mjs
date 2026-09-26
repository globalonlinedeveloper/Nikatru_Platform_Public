// ─────────────────────────────────────────────────────────────────────────────
// start-here.test.mjs — tooling/scripts/gen-start-here.mjs must WRITE the card
// the tree implies, must REFUSE a hand edit, and must refuse a tree it cannot
// measure. Three things, and the third is the one that is normally missing.
//
// 🔴 WHY A NEGATIVE TEST AND NOT A SMOKE TEST. `START-HERE.md` is the first file
// a cold session reads and the ONLY orientation it gets, so its failure mode is
// not "the build breaks", it is "every session after this one believes something
// untrue". The two ways that happens are a hand edit and a stale regeneration,
// and `--check` is the guard against both — which makes `--check`'s ABILITY TO
// EXIT 1 the property worth testing. A test that only ran the generator and read
// the file would pass identically against a `--check` that returned 0 always.
//
// ⚠️ THE FIXTURE IS A REAL GIT REPOSITORY WITH REAL FLOORS CLEARED. The generator
// reads the INDEX (`git ls-files --cached`) and refuses with exit 2 under any of
// its declared floors, so a small fixture would exercise nothing but the refusal
// branch — which is worth exactly one case, and is the last one here. The floors
// are READ from the generator rather than typed, so a floor that moves moves this
// fixture with it.
//
// ⚠️ AND THE FIXTURE IS NOT THIS REPOSITORY. `--check` is read-only, but the
// write path is not, and `node --test` runs files concurrently: a case that wrote
// the real `START-HERE.md` would be racing every other suite in the run. Nothing
// here touches the tree it is checked into.
//
// Run:  node --test "tooling/ci/test/start-here.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GEN_SRC = resolve(REPO, 'tooling', 'scripts', 'gen-start-here.mjs');

/** The generator's declared floors, read out of its source. A fixture built from
 *  numbers typed here would drift silently the day a floor is raised, and would
 *  then be testing the COVERAGE LOST branch while reporting on the happy one. */
function floors() {
  const src = readFileSync(GEN_SRC, 'utf8');
  const m = src.match(/const floors = (\{[^}]*\});/);
  assert.ok(m, 'gen-start-here.mjs no longer declares `const floors = { … };` — this file is reading the wrong thing');
  const out = {};
  for (const pair of m[1].replace(/[{}]/g, '').split(',')) {
    const [k, v] = pair.split(':').map((x) => x.trim());
    if (k) out[k] = Number(v);
  }
  return out;
}
const FLOORS = floors();

let BASE, ROOT;

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

/** Six redirecting git variables stripped, for the reason `repo-git.mjs` records:
 *  git EXPORTS them into every hook process and they BEAT `-C`, so a generator
 *  spawned from inside a commit would read the committing repo's index. */
function run(where, ...argv) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(where, 'tooling', 'scripts', 'gen-start-here.mjs'), ...argv], { cwd: where, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A workflow with a `ci-gate` job whose `needs:` list clears the gateNeeds
 *  floor. Written in the BLOCK form on purpose: the generator reads it through
 *  the shared `workflow-scan.mjs`, and a fixture that used a form the shared
 *  parser handles differently would be testing a parser this repo does not use. */
function ciYml(needs) {
  const lines = ['name: ci', 'on: [push]', 'jobs:'];
  for (const n of needs) lines.push(`  ${n}:`, '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo ok');
  lines.push('  ci-gate:', '    runs-on: ubuntu-24.04', '    needs:');
  for (const n of needs) lines.push(`      - ${n}`);
  lines.push('    steps:', '      - run: echo gate');
  return `${lines.join('\n')}\n`;
}

function buildFixture(root, { full = true } = {}) {
  mkdirSync(join(root, 'apps', 'demo'), { recursive: true });
  mkdirSync(join(root, 'tooling', 'scripts'), { recursive: true });
  mkdirSync(join(root, 'tooling', 'ci', 'test'), { recursive: true });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), '# fixture agents card\n');
  writeFileSync(join(root, 'apps', 'demo', 'app.md'), 'fixture app\n');
  /* An app is counted by its declaration, not by its directory (D2 below). */
  writeFileSync(join(root, 'apps', 'demo', 'app.yaml'), 'id: demo\n');

  const needs = Array.from({ length: Math.max(FLOORS.gateNeeds, 3) }, (_, i) => `lane-${i}`);
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), ciYml(needs));

  if (!full) return;

  for (let i = 0; i < FLOORS.workflows + 2; i += 1) {
    writeFileSync(join(root, '.github', 'workflows', `w-${i}.yml`), 'name: w\non: [push]\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ok\n');
  }
  for (let i = 0; i < FLOORS.guards + 5; i += 1) writeFileSync(join(root, 'tooling', 'ci', `assert-fixture-${i}.mjs`), '// fixture guard\n');
  for (let i = 0; i < FLOORS.guardTests + 5; i += 1) writeFileSync(join(root, 'tooling', 'ci', 'test', `fixture-${i}.test.mjs`), '// fixture test\n');
  for (let i = 0; i < Math.max(FLOORS.pkgs + 2, 6); i += 1) {
    mkdirSync(join(root, 'packages', `p-${i}`), { recursive: true });
    writeFileSync(join(root, 'packages', `p-${i}`, 'pubspec.yaml'), 'name: p\n');
  }
  /* topDirs counts non-dot top-level directories, so the fixture needs at least
     the floor's worth of them, and enough files overall to clear `tracked`. */
  const extraDirs = ['services', 'sites', 'extensions', 'contracts', 'catalog', 'docs', 'scripts'];
  for (const d of extraDirs) {
    mkdirSync(join(root, d, 'one'), { recursive: true });
    writeFileSync(join(root, d, 'one', 'f.md'), `fixture ${d}\n`);
  }
  let written = 0;
  const perDir = 60;
  for (let d = 0; written < FLOORS.tracked + 50; d += 1) {
    const dir = join(root, 'docs', `filler-${d}`);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < perDir; i += 1) { writeFileSync(join(dir, `f-${i}.md`), `filler ${d}/${i}\n`); written += 1; }
  }
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-starthere-'));
  ROOT = join(BASE, 'Fixture_Public');
  buildFixture(ROOT);
  git(ROOT, 'init', '-q');
  git(ROOT, 'config', 'user.email', 'fixture@example.test');
  git(ROOT, 'config', 'user.name', 'fixture');
  git(ROOT, 'config', 'commit.gpgsign', 'false');
  git(ROOT, 'add', '-A');
  git(ROOT, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  /* The generator and the ONE module it imports, copied in after the commit. */
  cpSync(GEN_SRC, join(ROOT, 'tooling', 'scripts', 'gen-start-here.mjs'));
  cpSync(resolve(REPO, 'tooling', 'ci', 'workflow-scan.mjs'), join(ROOT, 'tooling', 'ci', 'workflow-scan.mjs'));
  cpSync(resolve(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(ROOT, 'tooling', 'ci', 'tree-walk.mjs'));
  copyComposerImports(ROOT);
});

after(() => { rmSync(BASE, { recursive: true, force: true }); });

/** ⏱ 2026-09-26 — workflow-scan.mjs imports tooling/ci/flutter-release-build.mjs and
 *  tooling/ci/app-set.mjs (the census composes a composer call, O-FLUTTER-BUILD-TYPED-PER-LINE),
 *  and the composer imports tooling/app-yaml/yaml.mjs. A static import resolves before the module body runs, so a
 *  fixture without both dies with ERR_MODULE_NOT_FOUND (0 of 7 cases, measured) instead of
 *  reaching the property each case is about. */
function copyComposerImports(root) {
  cpSync(resolve(REPO, 'tooling', 'ci', 'app-set.mjs'), join(root, 'tooling', 'ci', 'app-set.mjs'));
  cpSync(resolve(REPO, 'tooling', 'ci', 'flutter-release-build.mjs'), join(root, 'tooling', 'ci', 'flutter-release-build.mjs'));
  mkdirSync(join(root, 'tooling', 'app-yaml'), { recursive: true });
  cpSync(resolve(REPO, 'tooling', 'app-yaml', 'yaml.mjs'), join(root, 'tooling', 'app-yaml', 'yaml.mjs'));
}

test('it WRITES a card, and the card is inside the 4 KiB the cap allows', () => {
  const r = run(ROOT);
  assert.equal(r.code, 0, `the generator must succeed over a tree above every floor: ${r.out}`);
  assert.match(r.out, /gen-start-here — \d+ tracked file\(s\), \d+ top dir\(s\), \d+ guard\(s\) with \d+ test file\(s\), ci-gate needs \d+ job\(s\)/);
  const card = readFileSync(join(ROOT, 'START-HERE.md'), 'utf8');
  assert.ok(Buffer.byteLength(card, 'utf8') <= 4096, `the card must fit the cap check-agent-docs enforces; it is ${Buffer.byteLength(card, 'utf8')} bytes`);
  /* The counts are INTERPOLATED, not narrated: the card must carry the same
     ci-gate figure the generator printed, or the two are reading different trees. */
  const needs = r.out.match(/ci-gate needs (\d+) job\(s\)/)[1];
  assert.ok(card.includes(`it needs ${needs} job(s) green`), `the card must carry the measured gate figure. Card:\n${card}`);
});

test('--check is GREEN on the card it just wrote', () => {
  const r = run(ROOT, '--check');
  assert.equal(r.code, 0, `green control, or the case below proves nothing: ${r.out}`);
  assert.match(r.out, /ok {2}START-HERE\.md is what the tree generates/);
});

test('--check EXITS 1 on a hand edit, and says the file is generated', () => {
  const abs = join(ROOT, 'START-HERE.md');
  const keep = readFileSync(abs, 'utf8');
  writeFileSync(abs, `${keep}\nA sentence somebody typed into a generated file.\n`);
  try {
    const r = run(ROOT, '--check');
    assert.equal(r.code, 1, `a hand edit must FAIL the check: ${r.out}`);
    assert.match(r.out, /differs from what the tree generates/);
    assert.match(r.out, /Never hand-edit it/);
  } finally {
    writeFileSync(abs, keep);
  }
  assert.equal(run(ROOT, '--check').code, 0, 'restored, the check must be green again');
});

test('--check EXITS 1 when the SHAPE moved and the card did not', () => {
  /* The other half, and the one a hand-edit test alone would miss: nobody typed
     into the file, the repository grew, and the card is now describing a tree
     that no longer exists. This is how `NOW.md` came to claim 73 rows over 107.

     ⏱ THE DRIFT IS A NEW PACKAGE, NOT A NEW GUARD, SINCE 2026-09-09. This case
     used to stage `tooling/ci/assert-fixture-new-guard.mjs`, which drifted the
     guard COUNT — a figure the card no longer carries, so the same edit is now
     correctly a no-op and this case would have passed while proving nothing.
     A package moves `pkgs`, which the card does carry, so the property under
     test — a card describing a tree that has moved must go red — is the same
     property, asserted through a figure that is still there. The case below
     (`the card carries NO per-file inventory count`) owns the other half. */
  const abs = join(ROOT, 'START-HERE.md');
  const keep = readFileSync(abs, 'utf8');
  const addedDir = join(ROOT, 'packages', 'p-fixture-new');
  mkdirSync(addedDir, { recursive: true });
  writeFileSync(join(addedDir, 'pubspec.yaml'), 'name: p_fixture_new\n');
  git(ROOT, 'add', '--', 'packages/p-fixture-new/pubspec.yaml');
  try {
    const r = run(ROOT, '--check');
    assert.equal(r.code, 1, `a card describing a stale tree must FAIL, or it can go stale silently: ${r.out}`);
    assert.match(r.out, /differs from what the tree generates/);
  } finally {
    git(ROOT, 'rm', '-q', '-f', '--cached', '--', 'packages/p-fixture-new/pubspec.yaml');
    rmSync(addedDir, { recursive: true, force: true });
    writeFileSync(abs, keep);
  }
  assert.equal(run(ROOT, '--check').code, 0, 'restored, the check must be green again');
});

test('🔴 the card carries NO per-file inventory count, so adding a guard or a test does NOT red it', () => {
  /* THE REGRESSION GUARD FOR THE WHOLE CLASS, and the reason this file changed on
     2026-09-09. `guards` and `guardTests` are counts of files in one directory,
     and adding one is the most ordinary thing a branch here does — measured over
     the last 30 commits on `main`, those two moved on 6 of them while every other
     card figure was constant. Under `strict` protection the correct value is the
     count of the UNION of the branch and `main`, so it is only computable AFTER
     the branch is updated, and every queued pull request paid it again on every
     rebase. Three pull requests went red on it on 2026-09-09 alone.

     Both halves are asserted, because either alone is weak. FIRST: staging a new
     guard AND a new guard test must leave `--check` GREEN — that is the tax being
     gone, and it is the only assertion that would fail if the counts came back.
     SECOND: the card must not contain the count as a NUMBER either, which catches
     the same figure returning under different wording. */
  const abs = join(ROOT, 'START-HERE.md');
  const keep = readFileSync(abs, 'utf8');
  assert.equal(run(ROOT, '--check').code, 0, 'green control, or this case proves nothing');

  const newGuard = join(ROOT, 'tooling', 'ci', 'assert-fixture-new-guard.mjs');
  const newTest = join(ROOT, 'tooling', 'ci', 'test', 'fixture-new.test.mjs');
  writeFileSync(newGuard, '// a guard that arrived after the card was written\n');
  writeFileSync(newTest, '// a guard test that arrived after the card was written\n');
  git(ROOT, 'add', '--', 'tooling/ci/assert-fixture-new-guard.mjs', 'tooling/ci/test/fixture-new.test.mjs');
  try {
    const r = run(ROOT, '--check');
    assert.equal(
      r.code,
      0,
      'a branch that adds a guard and a guard test must NOT red the card check — that recurring, ' +
        `unwinnable drift is exactly what removing the inventory counts fixed: ${r.out}`,
    );
  } finally {
    git(ROOT, 'rm', '-q', '-f', '--cached', '--', 'tooling/ci/assert-fixture-new-guard.mjs', 'tooling/ci/test/fixture-new.test.mjs');
    rmSync(newGuard, { force: true });
    rmSync(newTest, { force: true });
    writeFileSync(abs, keep);
  }
  assert.equal(run(ROOT, '--check').code, 0, 'restored, the check must be green again');

  /* The generator still MEASURES both, and says so on the run line — dropping the
     measurement rather than the card entry would have been the other mistake. */
  const written = run(ROOT);
  assert.equal(written.code, 0, written.out);
  const m = written.out.match(/(\d+) guard\(s\) with (\d+) test file\(s\)/);
  assert.ok(m, `the run line must still report both inventory counts: ${written.out}`);

  /* Matched on the PHRASING rather than on the bare integer, deliberately. A
     `\b<n>\b` search over the card collides with prose the card legitimately
     carries — `Private/TRAPS.md` is described as "another 105 KiB" and the
     fixture's own guard count is 105 — so a bare-number test would fail for a
     reason that has nothing to do with this property. Measured while writing it. */
  const card = readFileSync(abs, 'utf8');
  for (const [what, re] of [['guard count', /\d+\s+guards?\b/i], ['guard-test count', /\d+\s+test files?\b/i]]) {
    assert.ok(
      !re.test(card),
      `the card must not carry the ${what} — it is the figure that reddened three pull requests on ` +
        `2026-09-09, and it is reported on the run line instead. Card:\n${card}`,
    );
  }
});

/** Stage tracked files for one case, run `fn`, and take them out again. */
function withStaged(files, fn) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(ROOT, rel)), { recursive: true });
    writeFileSync(join(ROOT, rel), body);
  }
  git(ROOT, 'add', '--', ...Object.keys(files));
  try {
    return fn();
  } finally {
    git(ROOT, 'rm', '-q', '-f', '--cached', '--', ...Object.keys(files));
    for (const rel of Object.keys(files)) rmSync(join(ROOT, rel), { force: true });
  }
}

test('D2 — each figure counts its DEFINING set: a helper directory moves nothing, a real member moves the card', () => {
  /* O-PUBLIC-DOCS-HAND-WRITTEN-FACTS. Counting directories under a root printed
     3 Workers, 3 sites, 6 extensions and 12 Dart packages over a tree holding 2, 2,
     1 and 11, because `_shared/`, `extensions/docs/` and a JS package sit beside the
     members. So the property has two halves, and each is asserted on its own. */
  const abs = join(ROOT, 'START-HERE.md');
  const keep = readFileSync(abs, 'utf8');
  assert.equal(run(ROOT).code, 0, 'the card must be written first');
  assert.equal(run(ROOT, '--check').code, 0, 'green control, or this case proves nothing');
  const card = readFileSync(abs, 'utf8');
  const figures = (text) => text.match(/(\d+) app\(s\)[^·]*· (\d+) shared Dart packages · (\d+) Cloudflare Worker\(s\) ·\n(\d+) static site\(s\) · (\d+) extension\(s\)/);
  assert.ok(figures(card), `the card no longer carries the five shape figures in the shape this case reads. Card:\n${card}`);
  /* The fixture has helper directories under services/, sites/ and extensions/ and
     no defining file in any of them, so those three figures are 0, not 1. */
  assert.deepEqual(figures(card).slice(1).map(Number), [1, Math.max(FLOORS.pkgs + 2, 6), 0, 0, 0], `every figure must be its defining set's size. Card:\n${card}`);

  /* HALF ONE: helper directories with no defining file must NOT move the card. */
  withStaged({
    'services/_shared/src/util.ts': 'export {};\n',
    'sites/_shared/package.json': '{}\n',
    'extensions/docs/README.md': '# docs\n',
    'packages/tokens/package.json': '{}\n',
    'apps/notes/README.md': '# not an app: no app.yaml\n',
  }, () => {
    const r = run(ROOT, '--check');
    assert.equal(r.code, 0, `a directory that is not a member must move no figure: ${r.out}`);
  });

  /* HALF TWO: one real member of each set MUST move the card. */
  withStaged({
    'services/worker-two/wrangler.jsonc': '{}\n',
    'sites/site-two/index.html': '<!doctype html>\n',
    'extensions/Extension/Ext_Two/manifest.json': '{}\n',
  }, () => {
    const r = run(ROOT, '--check');
    assert.equal(r.code, 1, `a new Worker, site and extension must red a card that does not carry them: ${r.out}`);
    const w = run(ROOT);
    assert.equal(w.code, 0, w.out);
    assert.deepEqual(figures(readFileSync(abs, 'utf8')).slice(3).map(Number), [1, 1, 1], 'each staged member must count once');
  });
  writeFileSync(abs, keep);
  assert.equal(run(ROOT).code, 0, 'rewritten over the restored tree');
  assert.equal(readFileSync(abs, 'utf8'), card, 'restored, the card must be the card the green control read');
});

test('the card carries no size of a private register — the generator reads nothing outside the index', () => {
  /* CI's `--check` has no private corpus, so a size read off `Private/` would make the
     card differ between a host and CI; a typed one is a hand-written fact. */
  assert.equal(run(ROOT).code, 0);
  const card = readFileSync(join(ROOT, 'START-HERE.md'), 'utf8');
  assert.doesNotMatch(card, /\d+\s*KiB of register|another \d+\s*KiB/, `the card carries a register size again. Card:\n${card}`);
  const src = readFileSync(GEN_SRC, 'utf8');
  assert.doesNotMatch(src, /Nikatru_Platform_Private['"`]\s*[,)]|join\([^)]*['"`]Private['"`]/, 'the generator builds a path into the private corpus');
});

test('a tree under the floors is COVERAGE LOST — exit 2, never a pass and never a card', () => {
  const thin = join(BASE, 'Thin_Public');
  buildFixture(thin, { full: false });
  git(thin, 'init', '-q');
  git(thin, 'config', 'user.email', 'fixture@example.test');
  git(thin, 'config', 'user.name', 'fixture');
  git(thin, 'config', 'commit.gpgsign', 'false');
  git(thin, 'add', '-A');
  git(thin, 'commit', '-q', '-m', 'thin', '--no-gpg-sign');
  cpSync(GEN_SRC, join(thin, 'tooling', 'scripts', 'gen-start-here.mjs'));
  mkdirSync(join(thin, 'tooling', 'ci'), { recursive: true });
  cpSync(resolve(REPO, 'tooling', 'ci', 'workflow-scan.mjs'), join(thin, 'tooling', 'ci', 'workflow-scan.mjs'));
  cpSync(resolve(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(thin, 'tooling', 'ci', 'tree-walk.mjs'));
  copyComposerImports(thin);

  const r = run(thin);
  assert.equal(r.code, 2, `a tree it cannot measure must REFUSE, not write a confident wrong card: ${r.out}`);
  assert.match(r.out, /COVERAGE LOST/);
  assert.match(r.out, /A floor is a declared minimum/);
  assert.equal(existsSyncSafe(join(thin, 'START-HERE.md')), false, 'a refused run must not leave a card behind');
});

function existsSyncSafe(p) {
  try { readFileSync(p); return true; } catch { return false; }
}

test('a tree missing a sentinel is COVERAGE LOST — exit 2, and it names the sentinel', () => {
  const nope = join(BASE, 'NotThisRepo');
  mkdirSync(join(nope, 'tooling', 'scripts'), { recursive: true });
  mkdirSync(join(nope, 'tooling', 'ci'), { recursive: true });
  cpSync(GEN_SRC, join(nope, 'tooling', 'scripts', 'gen-start-here.mjs'));
  /* The two imported modules are copied in even though this tree is meant to be
     REJECTED, and the reason is a real property of ESM rather than tidiness: a
     static import is resolved before the first line of the module body, so a
     fixture without them dies with ERR_MODULE_NOT_FOUND and exit 1 — which looks
     nothing like the refusal this case is about, and would have been recorded as
     one. Measured while writing this file. */
  cpSync(resolve(REPO, 'tooling', 'ci', 'workflow-scan.mjs'), join(nope, 'tooling', 'ci', 'workflow-scan.mjs'));
  cpSync(resolve(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(nope, 'tooling', 'ci', 'tree-walk.mjs'));
  copyComposerImports(nope);
  const r = run(nope);
  assert.equal(r.code, 2, `a tree that is not this repository must REFUSE: ${r.out}`);
  assert.match(r.out, /COVERAGE LOST/);
  assert.match(r.out, /does not look like Nikatru_Platform_Public \(missing/);
});
