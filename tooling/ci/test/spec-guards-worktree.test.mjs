// ─────────────────────────────────────────────────────────────────────────────
// spec-guards-worktree.test.mjs — the pre-commit runner must run FROM A LINKED
// GIT WORKTREE, and must still refuse when the main checkout cannot answer either.
//
// 🔴 THE DEFECT, AND ITS COST IN BEHAVIOUR RATHER THAN IN OUTPUT. `.claude/` is
// gitignored IN FULL — it is the local credential vault — and `CLAUDE.md` is
// gitignored too, so NEITHER is ever checked out into a worktree: a worktree gets
// tracked files and nothing else. `assert-spec` walks the public repo it derives
// from the corpus and requires four top-level anchors, `CLAUDE.md` among them,
// before it will resolve the eight `invariants.json` and `gates.json` ENFORCEMENT
// rows that name `.claude/scripts/…`. And the runner named the private corpus from
// the WORKTREE'S OWN directory name, so `Projects/structure_Public` composed
// `Projects/structure_Private`, a corpus that has never existed, and the run died
// at `CANNOT RUN — the private corpus was not found` before reading a single guard.
//
// So a worktree could not commit at all without `--no-verify`, which is a root
// `AGENTS.md` prohibition. THREE AGENTS USED IT ANYWAY ON 2026-09-07, and a fourth
// abandoned a finished, staged, guard-green branch and re-applied it as a patch in
// the main checkout. Recorded in Private research/full-read-2026-09-08/
// S2-structure-apply-2026-09-08.md sections 9 and 12. A guard that cannot run
// where people work is a guard people learn to bypass, and a bypassed guard is
// worth less than no guard because it also carries the belief that something was
// checked.
//
// ⚠️ THE FIX MUST NOT BE A SKIP, AND THAT IS WHAT HALF THIS FILE IS FOR. The
// tempting shape — "no `.claude/` here, so treat those rows as not applicable" —
// is the vacuous pass this corpus keeps catching, and it would silently retire
// eight enforcement rows for every worktree commit forever. What the runner does
// instead is RESOLVE: `git rev-parse --git-common-dir` names the main checkout,
// and the pair is derived from THAT. Nothing is copied. The case
// `still fails when the main checkout is missing it too` is the one that proves
// the difference between resolving and skipping, and it is the case to keep
// pointing at if anyone ever proposes making this quieter.
//
// ── EVERY CASE CARRIES ITS OWN MUTANT ────────────────────────────────────────
// The mutants here are one-line edits to a COPY of the runner that put each half
// of the fix back into the defect: the sibling derived from the worktree's name
// again, and the "am I missing an anchor" probe answering no. Both must turn the
// green worktree run below back into `CANNOT RUN`. A source-text assertion could
// not do this — the whole defect is that the source looked right.
//
// ⚠️ THE FIXTURE IS A REAL REPOSITORY AND A REAL `git worktree add`. Anything less
// would not exercise `--git-common-dir`, which is the only thing the fix rests on.
// The guards themselves are STUBS, and two of them assert rather than pass: the
// `assert-spec` stub re-implements that guard's anchor limb (derive the `_Public`
// sibling from the corpus it lives in, refuse when an anchor is absent) and the
// `assert-public-citations` stub records the corpus it was handed. Stubbing the
// rest keeps this file about path resolution, which is the only thing that changed.
//
// Run:  node --test "tooling/ci/test/spec-guards-worktree.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync, renameSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DECLARATION_REL, PINNED_HOOK } from '../../scripts/guard-declaration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // tooling/ci/test -> repo root
const RUNNER_SRC = resolve(REPO, 'tooling', 'scripts', 'spec-guards.mjs');
const GIT_HELPER_SRC = resolve(REPO, 'tooling', 'scripts', 'repo-git.mjs');
const LOADER_SRC = resolve(REPO, 'tooling', 'scripts', 'guard-declaration.mjs');
const PIN_SRC = resolve(REPO, 'tooling', 'scripts', 'hook-runner-pin.mjs');   // imported by the runner since 2026-09-24
const SOURCE = readFileSync(RUNNER_SRC, 'utf8');

/* The two paths the ENFORCEMENT rows need at the repo root, read out of the runner
   rather than typed here: if the list ever changes, this file must follow it or it
   is building a worktree that is missing the wrong things. */
const HOST_ANCHORS = (() => {
  const m = /const HOST_ANCHORS = \[([^\]]+)\];/.exec(SOURCE);
  assert.ok(m, 'spec-guards.mjs no longer declares `const HOST_ANCHORS = [...]` — this file is reading the wrong thing');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

/** The rows still typed in the runner's GUARDS table, by their FIRST `rel` candidate.
 *  ⏱ 2026-09-24: the corpus's own rows left the table for the corpus's declaration
 *  (`requirements/tooling/guards.json`, read by guard-declaration.mjs), so the table
 *  holds only the rows whose subject is public — two on the day. */
function staticRels(src) {
  const start = src.indexOf('const GUARDS = [');
  assert.notEqual(start, -1, 'the GUARDS table is gone');
  const table = src.slice(start, src.indexOf('\n];', start));
  const out = [];
  const re = /\{\s*name:\s*'([^']+)',[\s\S]*?rel:\s*\[\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(table)) !== null) out.push({ name: m[1], rel: m[2] });
  assert.ok(out.length >= 2, `parsed ${out.length} static guard rows, expected at least 2 — the row shape changed and this fixture would stub nothing`);
  return out;
}

/** The fixture corpus's declaration: every pinned guard on both sides, at the path the
 *  real declaration gives it, plus one hook:["private"] entry, which a commit outside
 *  the corpus must not run. The pin comes from the loader, so a guard pinned tomorrow is
 *  declared and stubbed here tomorrow. */
const PUBLIC_FILE = new Set(['check-dod-sync', 'assert-public-citations']);
const PRIVATE_ONLY = 'fixture-private-only';
const DECLARED = [
  ...PINNED_HOOK.map((id) => ({
    id,
    file: PUBLIC_FILE.has(id) ? `tooling/scripts/${id}.mjs` : `requirements/tooling/${id}.mjs`,
    hook: ['public', 'private'],
    args: [],
    what: `fixture stub for ${id}`,
  })),
  { id: PRIVATE_ONLY, file: `requirements/tooling/${PRIVATE_ONLY}.mjs`, hook: ['private'], args: [], what: 'runs from a commit in the corpus only' },
];
const declaredRels = (side) => DECLARED.filter((e) => e.hook.includes(side)).map((e) => ({ name: e.id, rel: e.file }));

/** Every guard the runner will try to locate from a PUBLIC commit: the declared rows
 *  that hook the public side, then the static ones — the order the runner runs them. */
const GUARD_ROWS = [...declaredRels('public'), ...staticRels(SOURCE)];
// RE-BASED 9 -> 7 on 2026-09-08: three rows retired with their subjects (assert-session-index, assert-research-archive, assert-plans-archive), so the runner declares 7 and a floor of 9 would refuse on a complete read.
assert.ok(GUARD_ROWS.length >= 7, `the fixture names ${GUARD_ROWS.length} guard rows, expected at least 7 — this fixture would stub almost nothing`);
/** And from a commit IN the corpus. */
const CORPUS_ROWS = [...declaredRels('private'), ...staticRels(SOURCE)];

let BASE;      // the throwaway workspace
let PUB;       // <BASE>/Projects/Fixture_Public   — the MAIN checkout
let WT;        // <BASE>/Projects/Fixturewt_Public — the linked worktree
let PRIV;      // <BASE>/Projects/Fixture_Private  — the corpus
let ENV_SEEN;
let GITDIR_SEEN;  // where the assert-public-citations stub records what it was handed
let PRIVATE_RAN;  // where the hook:["private"] stub records that it ran

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

const write = (abs, text) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text, 'utf8'); };

/** The `assert-spec` stub: the real guard's identity limb and nothing else. It
 *  derives the public repo the way the real one does — the corpus it lives in, with
 *  `_Private` swapped for `_Public` — and refuses with code 2 when an anchor is
 *  absent there. This is what makes "the main checkout is missing it too" a real
 *  failure rather than a sentence in a comment. */
const ANCHOR_STUB = `import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = resolve(HERE, '..', '..');
const n = basename(CORPUS);
const REPO = resolve(CORPUS, '..', n.endsWith('_Private') ? n.slice(0, -'_Private'.length) + '_Public' : n + '_Public');
const ANCHORS = ${JSON.stringify(HOST_ANCHORS)};
const missing = ANCHORS.filter((rel) => !existsSync(join(REPO, ...rel.split('/'))));
writeFileSync(join(CORPUS, 'assert-spec-saw.txt'), REPO + '\\n' + missing.join(','), 'utf8');
if (missing.length) {
  console.error('CANNOT RUN - ' + REPO + ' does not look like this repository root. Missing: ' + missing.join(', '));
  process.exit(2);
}
console.log('ok anchors resolved at ' + REPO);
process.exit(0);
`;

/** The `assert-public-citations` stub: records the corpus root it was handed, so the
 *  "the children are told which corpus was elected" half is asserted on a file
 *  rather than on the runner's own printed summary. */
const ENV_STUB = `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.FIXTURE_ENV_SEEN, String(process.env.NIKATRU_PRIVATE_ROOT ?? ''), 'utf8');
writeFileSync(process.env.FIXTURE_GITDIR_SEEN, String(process.env.GIT_DIR ?? ''), 'utf8');
process.exit(0);
`;

/** The hook:["private"] stub: records that it ran, so "a Public commit does not run
 *  it" is asserted on a file rather than on a count. */
const PRIVATE_ONLY_STUB = `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.FIXTURE_PRIVATE_RAN, 'ran', 'utf8');
process.exit(0);
`;

/* ⏱ 2026-09-24: the corpus is a REAL repository now, because the runner reads its
   declared guard set out of a git blob — `HEAD:` from a commit outside it, the index
   from a commit in it — and never out of the working tree. */
function buildCorpus() {
  rmSync(PRIV, { recursive: true, force: true });
  // The corpus marker the runner probes for: a NON-EMPTY `requirements/`.
  write(join(PRIV, 'requirements', 'index.json'), '{}\n');
  for (const { name, rel } of [...CORPUS_ROWS, ...GUARD_ROWS]) {
    const body = name === 'assert-spec' ? ANCHOR_STUB
      : name === 'assert-public-citations' ? ENV_STUB
        : name === PRIVATE_ONLY ? PRIVATE_ONLY_STUB
          : `process.exit(0);\n`;
    write(join(PRIV, rel), body);
  }
  write(join(PRIV, ...DECLARATION_REL.split('/')), `${JSON.stringify({ entries: DECLARED }, null, 2)}\n`);
  git(PRIV, 'init', '-q');
  git(PRIV, 'config', 'user.email', 'fixture@example.test');
  git(PRIV, 'config', 'user.name', 'fixture');
  git(PRIV, 'config', 'commit.gpgsign', 'false');
  git(PRIV, 'add', '-A');
  git(PRIV, 'commit', '-q', '-m', 'fixture corpus', '--no-gpg-sign');
}

/** Run the runner from `where`, with a copy of the environment that cannot smuggle
 *  the answer in: the machine running this suite has a real corpus and may well have
 *  `NIKATRU_PRIVATE_ROOT` set, and git exports `GIT_DIR` into hooks. */
function runRunner(where, file = 'spec-guards.mjs', { gitDir = null, cwd = where } = {}) {
  const env = { ...process.env, FIXTURE_ENV_SEEN: ENV_SEEN, FIXTURE_GITDIR_SEEN: GITDIR_SEEN, FIXTURE_PRIVATE_RAN: PRIVATE_RAN };
  delete env.NIKATRU_PRIVATE_ROOT;
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  // `gitDir` is git's own export, put back DELIBERATELY: a pre-commit hook always
  // has it, so a suite that only ever deletes it tests the one environment the
  // runner is never in.
  if (gitDir) env.GIT_DIR = gitDir;
  rmSync(ENV_SEEN, { force: true });
  rmSync(GITDIR_SEEN, { force: true });
  rmSync(PRIVATE_RAN, { force: true });
  // `cwd` is where git would run the hook from: the root of the work tree being
  // committed. The corpus's own hook runs THIS repo's runner with cwd = the corpus.
  const r = spawnSync(process.execPath, [join(where, 'tooling', 'scripts', file), '--fast'], { cwd, env, encoding: 'utf8' });
  return {
    code: r.status,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    envSeen: existsSync(ENV_SEEN) ? readFileSync(ENV_SEEN, 'utf8') : null,
    gitDirSeen: existsSync(GITDIR_SEEN) ? readFileSync(GITDIR_SEEN, 'utf8') : null,
    privateRan: existsSync(PRIVATE_RAN),
  };
}

/** A one-substitution copy of the runner, written beside it in both trees so it
 *  resolves the same helper module. Each mutation puts one half of the fix back
 *  into the defect it closes. */
function writeMutant(name, from, to) {
  assert.ok(SOURCE.includes(from), `cannot build the ${name} mutant — spec-guards.mjs no longer contains \`${from}\`, so the case using it is asserting nothing`);
  const mutant = SOURCE.replace(from, to);
  assert.notEqual(mutant, SOURCE, 'the mutation changed nothing');
  for (const tree of [PUB, WT]) write(join(tree, 'tooling', 'scripts', name), mutant);
}

before(() => {
  /* 🔴 CANONICALISED IMMEDIATELY. On this host `os.tmpdir()` answers in the 8.3 SHORT
     form (`C:/Users/LOCALU~1/...`) while git answers with the long one, so two spellings
     of ONE directory compare unequal and every path assertion below fails over a
     filename convention rather than over behaviour. repo-git.mjs carries the same note
     for the same reason. Done once, here, so nothing downstream has to remember it. */
  BASE = realpathSync.native(mkdtempSync(join(tmpdir(), 'nikatru-wt-')));
  const PRODUCTS = join(BASE, 'Projects');
  PUB = join(PRODUCTS, 'Fixture_Public');
  WT = join(PRODUCTS, 'Fixturewt_Public');
  PRIV = join(PRODUCTS, 'Fixture_Private');
  ENV_SEEN = join(BASE, 'env-seen.txt');
  GITDIR_SEEN = join(BASE, 'gitdir-seen.txt');
  PRIVATE_RAN = join(BASE, 'private-only-ran.txt');

  // The workspace anchor: `Projects/` and `nikatru/` side by side.
  write(join(BASE, 'nikatru', 'README.md'), 'the shared business brain, fixture\n');

  // The main checkout. Only the runner, its git helper and its declaration loader are
  // TRACKED — which is what puts them in the worktree and keeps everything else out of it.
  mkdirSync(PUB, { recursive: true });
  mkdirSync(join(PUB, 'tooling', 'scripts'), { recursive: true });
  cpSync(RUNNER_SRC, join(PUB, 'tooling', 'scripts', 'spec-guards.mjs'));
  cpSync(GIT_HELPER_SRC, join(PUB, 'tooling', 'scripts', 'repo-git.mjs'));
  cpSync(LOADER_SRC, join(PUB, 'tooling', 'scripts', 'guard-declaration.mjs'));
  cpSync(PIN_SRC, join(PUB, 'tooling', 'scripts', 'hook-runner-pin.mjs'));
  git(PUB, 'init', '-q');
  git(PUB, 'config', 'user.email', 'fixture@example.test');
  git(PUB, 'config', 'user.name', 'fixture');
  git(PUB, 'config', 'commit.gpgsign', 'false');
  /* The real repo stores LF (`.gitattributes`: `* text=auto eol=lf`). This fixture has
     no `.gitattributes`, so on a machine with `core.autocrlf=true` the WORKTREE checkout
     would come back CRLF and the byte-identity case at the end would fail over line
     endings rather than over drift. Pinned here rather than worked around there. */
  git(PUB, 'config', 'core.autocrlf', 'false');
  git(PUB, 'config', 'core.eol', 'lf');
  git(PUB, 'add', '-A');
  git(PUB, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  /* The gitignored pair, created AFTER the commit and never tracked — which is
     exactly how they exist in the real repo, and the reason no worktree has them. */
  for (const rel of HOST_ANCHORS) write(join(PUB, ...rel.split('/')), 'fixture\n');

  git(PUB, 'worktree', 'add', '-q', '-b', 'fixture-wt', WT, 'HEAD');
  buildCorpus();
});

after(() => {
  try { git(PUB, 'worktree', 'remove', '--force', WT); } catch { /* the rm below is the real cleanup */ }
  rmSync(BASE, { recursive: true, force: true });
});

test('the fixture reproduces the defect: the worktree has the runner and neither gitignored anchor', () => {
  assert.ok(existsSync(join(WT, 'tooling', 'scripts', 'spec-guards.mjs')), 'the runner is not in the worktree, so nothing below runs from one');
  for (const rel of HOST_ANCHORS) {
    assert.equal(existsSync(join(WT, ...rel.split('/'))), false, `${rel} is present in the worktree — the fixture is not reproducing the condition every case below is about`);
    assert.equal(existsSync(join(PUB, ...rel.split('/'))), true, `${rel} is missing from the MAIN checkout, so the fixture cannot tell "resolved from the main checkout" from "found nowhere"`);
  }
  const common = git(WT, 'rev-parse', '--git-common-dir').trim();
  assert.equal(resolve(WT, common).replace(/\\/g, '/').toLowerCase(), join(PUB, '.git').replace(/\\/g, '/').toLowerCase(), 'git does not name the main checkout from this worktree, so the mechanism the fix rests on is not present in this fixture');
});

test('the runner runs from a linked worktree, resolving the anchors from the main checkout', () => {
  const r = runRunner(WT);
  assert.equal(r.code, 0, `the runner must run from a worktree: ${r.out}`);
  assert.match(r.out, /worktree mode/, 'the run must SAY it resolved elsewhere — a silent redirection is how a reader stops being able to check which tree was graded');
  assert.ok(r.out.includes(PUB), `the main checkout must be named in the output. Got: ${r.out}`);
  assert.match(r.out, new RegExp(`${GUARD_ROWS.length} guard\\(s\\) in`), `all ${GUARD_ROWS.length} guards must have run: ${r.out}`);

  const saw = readFileSync(join(PRIV, 'assert-spec-saw.txt'), 'utf8').split('\n');
  assert.equal(resolve(saw[0]).replace(/\\/g, '/').toLowerCase(), PUB.replace(/\\/g, '/').toLowerCase(), 'the spec guard was pointed at some tree other than the main checkout');
  assert.equal(saw[1], '', 'the spec guard still reported a missing anchor');

  assert.equal(resolve(r.envSeen).replace(/\\/g, '/').toLowerCase(), PRIV.replace(/\\/g, '/').toLowerCase(), 'the elected corpus was not passed to the child guards, so a guard that resolves the prefix for itself would land somewhere else');
});

test('NOTHING is copied into the worktree — the credential vault stays in the one checkout that has it', () => {
  const r = runRunner(WT);
  assert.equal(r.code, 0, r.out);
  for (const rel of HOST_ANCHORS) {
    assert.equal(existsSync(join(WT, ...rel.split('/'))), false, `${rel} appeared in the worktree. Copying a gitignored credential vault to satisfy a guard is the trade this fix exists to avoid, and a guard reading a copy is asserting about the copy.`);
  }
  assert.equal(existsSync(join(WT, '.claude')), false, 'a `.claude/` directory was created in the worktree');
});

test('MUTANT — the sibling named from the worktree instead of the main checkout: CANNOT RUN', () => {
  writeMutant('mutant-name-from-repo.mjs', 'const REPO_NAME = basename(HOST_ROOT);', 'const REPO_NAME = basename(REPO);');
  const r = runRunner(WT, 'mutant-name-from-repo.mjs');
  assert.equal(r.code, 2, `naming the pair from the worktree must refuse, or the case above proves nothing about WHERE the name came from: ${r.out}`);
  assert.match(r.out, /the private corpus was not found/);
  assert.match(r.out, /Fixturewt_Private/, 'the mutant refused for some reason other than composing the worktree-named sibling — the reproduction is not the recorded one');
});

test('MUTANT — the missing-anchor probe answering no: CANNOT RUN', () => {
  writeMutant('mutant-never-worktree.mjs', 'const ABSENT_HERE = absentHostAnchors(REPO);', 'const ABSENT_HERE = [];');
  const r = runRunner(WT, 'mutant-never-worktree.mjs');
  assert.equal(r.code, 2, `never entering worktree mode must refuse: ${r.out}`);
  assert.doesNotMatch(r.out, /worktree mode/, 'the mutant still entered worktree mode, so the probe is not what gates it');
});

test('CLAUDE.md present in the worktree and the vault absent still resolves — the probe is the SET, not one file', () => {
  write(join(WT, 'CLAUDE.md'), 'a hand-written copy, which the vault can never be\n');
  try {
    const r = runRunner(WT);
    assert.equal(r.code, 0, `one anchor present and one absent must still resolve: ${r.out}`);
    assert.match(r.out, /worktree mode/, 'a worktree missing only the VAULT stopped being treated as a worktree, which is the eight enforcement rows going unresolved again');
    assert.doesNotMatch(r.out, /this tree is missing CLAUDE\.md ,/, 'CLAUDE.md was reported absent while it was present');
  } finally {
    rmSync(join(WT, 'CLAUDE.md'), { force: true });
  }
});

test('it STILL FAILS when the main checkout is missing the file too — resolving is not skipping', () => {
  const victim = join(PUB, ...HOST_ANCHORS[0].split('/'));
  renameSync(victim, `${victim}.moved`);
  try {
    const r = runRunner(WT);
    assert.equal(r.code, 2, `with the anchor absent everywhere the run must refuse. If this is ever 0, the fix has become a skip and eight enforcement rows are being retired silently on every worktree commit: ${r.out}`);
    assert.match(r.out, /worktree mode/, 'the runner must still say it looked at the main checkout');
    assert.ok(r.out.includes('the main checkout is missing them too'), `the runner must name the diagnosis rather than let the guard\'s own refusal stand alone: ${r.out}`);
    assert.match(r.out, /could not run/, 'the refusal must be COVERAGE LOST, not a finding');

    const saw = readFileSync(join(PRIV, 'assert-spec-saw.txt'), 'utf8').split('\n');
    assert.equal(resolve(saw[0]).replace(/\\/g, '/').toLowerCase(), PUB.replace(/\\/g, '/').toLowerCase(), 'the guard did not even reach the main checkout, so this case is not the one it claims to be');
    assert.equal(saw[1], HOST_ANCHORS[0], 'the guard refused over the wrong anchor');
  } finally {
    renameSync(`${victim}.moved`, victim);
  }
});

test('the MAIN checkout is unchanged by all of this: no worktree mode, no override handed down', () => {
  const r = runRunner(PUB);
  assert.equal(r.code, 0, `the main checkout must keep passing: ${r.out}`);
  assert.doesNotMatch(r.out, /worktree mode/, 'a main checkout entered worktree mode — `--git-common-dir` resolves to itself there and nothing should change');
  assert.equal(r.envSeen, '', 'NIKATRU_PRIVATE_ROOT was handed to the children from a main checkout, where every guard already resolves the pair for itself');
  assert.match(r.out, new RegExp(`${GUARD_ROWS.length} guard\\(s\\) in`));
});

test('the fixture runner is the committed one, byte for byte', () => {
  assert.equal(readFileSync(join(WT, 'tooling', 'scripts', 'spec-guards.mjs'), 'utf8'), SOURCE, 'the copy under test has drifted from the runner in the tree');
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SECOND WORKTREE DEFECT, 2026-09-09: the runner resolved the corpus and then
// handed its guards an environment that pointed them somewhere else.
//
// Git exports `GIT_DIR` into every hook process and it BEATS both `-C` and a
// child's cwd. `CHILD_ENV` was a bare `{ ...process.env }`, so the two `--index`
// guards — whose subject is the PRIVATE corpus's staged index — read the index of
// whichever repository the commit was being made in. From the main checkout that
// is the same repository twice and nothing looks wrong; from a WORKTREE it is not.
//
// It surfaced as `check-agent-docs` exiting 2 on `docsScanned 2 < 3` while printing
// `check-agent-docs - Nikatru_Platform_Private` above 2065 tracked files and 2
// instruction docs — the private repo's NAME over the public worktree's NUMBERS.
// Two is what the public tree has. Reproduced exactly by exporting one variable:
//   cd <private> && node …/check-agent-docs.mjs --index                  → EXIT 0
//   cd <private> && GIT_DIR=<public wt>/.git node …/check-agent-docs.mjs → EXIT 2
//
// ⚠️ AND IT PRESENTED AS A FLOOR SET TOO HIGH, which is the trap worth recording:
// the obvious "fix" is to lower the floor to 2, which would make every worktree
// commit green over the wrong repository, permanently.
// ─────────────────────────────────────────────────────────────────────────────
test("git's exported GIT_DIR does not reach the guards — the child environment is scrubbed", () => {
  const decoy = join(PUB, '.git');
  const r = runRunner(WT, 'spec-guards.mjs', { gitDir: decoy });
  assert.equal(r.code, 0, `the runner must still run with GIT_DIR exported, as a hook always has it: ${r.out}`);
  assert.equal(r.gitDirSeen, '', `a guard was handed GIT_DIR=${r.gitDirSeen}; -C and cwd do not beat it, so its subject was the wrong repository`);
  assert.match(r.out, /Redirecting GIT_\* variables removed from the child environment: GIT_DIR/);
});

test('MUTANT — CHILD_ENV back to a bare copy of process.env: GIT_DIR reaches the guards', () => {
  writeMutant('spec-guards-envleak.mjs', 'const CHILD_ENV = cleanGitEnv().env;', 'const CHILD_ENV = { ...process.env };');
  const decoy = join(PUB, '.git');
  const r = runRunner(WT, 'spec-guards-envleak.mjs', { gitDir: decoy });
  assert.equal(
    r.gitDirSeen,
    decoy,
    'the mutant did NOT leak GIT_DIR, so the case above is passing for some other reason and proves nothing about the scrub',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DRIFT LIMB, 2026-09-24 (O-PRIVATE-HOOK-RUNNER-FOLLOWS-A-LIVE-BRANCH). A
// corpus commit runs whichever copy of this runner the corpus's `core.hooksPath`
// reaches. Measured in a scratch pair before the fix: a corpus commit through the
// main checkout on branch `live-feature` exited 0, graded by that branch's guards.
// From the corpus, the runner now refuses (exit 1) any runner but the pinned one —
// `.worktrees/hooks-runner-main`, detached at origin/main, no edits — before a
// single guard runs. The cases below run it with cwd = the corpus, which is where
// git runs every corpus hook from, and with the GIT_DIR git exports into one.
// ─────────────────────────────────────────────────────────────────────────────
const PINNED_RUNNER = () => join(BASE, 'Projects', '.worktrees', 'hooks-runner-main');

/** The corpus is a directory of stubs until here; the limb asks git which repository
 *  the cwd sits in, so it becomes one. Idempotent. */
function corpusIsARepo() {
  if (!existsSync(join(PRIV, '.git'))) git(PRIV, 'init', '-q');
}

test('the drift limb: a corpus commit through a BRANCH checkout of the runner is a finding (1) that names it', () => {
  corpusIsARepo();
  const branch = git(PUB, 'symbolic-ref', '--short', 'HEAD').trim();
  const r = runRunner(PUB, 'spec-guards.mjs', { cwd: PRIV, gitDir: join(PRIV, '.git') });
  assert.equal(r.code, 1, `a corpus commit judged by a branch checkout must be refused: ${r.out}`);
  assert.match(r.out, /RUNNER DRIFT/, r.out);
  assert.ok(r.out.includes(PUB), `the finding must name the checkout that loaded the runner: ${r.out}`);
  assert.ok(r.out.includes(`branch \`${branch}\``), `the finding must name its branch: ${r.out}`);
  assert.doesNotMatch(r.out, /guard\(s\) in/, 'guards ran after the limb refused, so their verdict was reported as if it counted');
});

test('MUTANT — the drift limb never applies: the same corpus commit through a branch checkout passes (the pre-fix behaviour)', () => {
  corpusIsARepo();
  writeMutant('mutant-no-drift-limb.mjs', 'if (INVOKED_FROM && sameDir(INVOKED_FROM, PRIVATE_ROOT)) {', 'if (false) {');
  const r = runRunner(PUB, 'mutant-no-drift-limb.mjs', { cwd: PRIV, gitDir: join(PRIV, '.git') });
  assert.equal(r.code, 0, `with the limb off the branch checkout must pass, or the case above is red for some other reason: ${r.out}`);
  assert.doesNotMatch(r.out, /RUNNER DRIFT/);
});

test('the drift limb: the pinned runner at origin/main passes (0), says so, and every guard runs', () => {
  corpusIsARepo();
  git(PUB, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (!existsSync(PINNED_RUNNER())) git(PUB, 'worktree', 'add', '-q', '--detach', PINNED_RUNNER(), 'origin/main');
  const r = runRunner(PINNED_RUNNER(), 'spec-guards.mjs', { cwd: PRIV, gitDir: join(PRIV, '.git') });
  assert.equal(r.code, 0, `the pinned runner must judge a corpus commit: ${r.out}`);
  assert.match(r.out, /the pinned runner at origin\/main/, r.out);
  // A corpus commit runs the corpus side of the declared set (cwd = the corpus).
  assert.match(r.out, new RegExp(`${CORPUS_ROWS.length} guard\\(s\\) in`), r.out);
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-24 — THE DECLARED SET (O-GUARD-SET-DECLARED-NOWHERE). The corpus's own
// guards are entries in its `requirements/tooling/guards.json`, and the runner reads
// them out of a git blob: `HEAD:` from a commit outside the corpus, the index from a
// commit in it. These cases run the runner end to end over the fixture corpus — which
// side a run is on, which blob that side reads, and the refusal when the pin breaks.
// The loader's own limbs are graded in guard-declaration.test.mjs.
// ⏱ 2026-09-26 (train W17): these run AFTER the drift limb's first three cases, and a run
// with cwd = the corpus goes through the PINNED runner those cases create — from any other
// checkout the drift limb now refuses a corpus commit before the declared set is read.
// ─────────────────────────────────────────────────────────────────────────────
test('a commit outside the corpus runs the hook:["public"] entries from HEAD, and not a hook:["private"] one', () => {
  const r = runRunner(PUB);
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes(`hook the public side, read from HEAD:${DECLARATION_REL}`), `the run did not name the committed declaration: ${r.out}`);
  assert.equal(r.privateRan, false, 'a hook:["private"] entry ran from a commit outside the corpus');
  assert.match(r.out, new RegExp(`${GUARD_ROWS.length} guard\\(s\\) in`));
});

test('a commit IN the corpus reads the STAGED declaration and runs its hook:["private"] entries', () => {
  const r = runRunner(PINNED_RUNNER(), 'spec-guards.mjs', { cwd: PRIV });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes(`hook the private side, read from :${DECLARATION_REL}`), `the run did not read the staged declaration: ${r.out}`);
  assert.equal(r.privateRan, true, 'the hook:["private"] entry did not run from a commit in the corpus');
  assert.match(r.out, new RegExp(`${CORPUS_ROWS.length} guard\\(s\\) in`));
});

test('MUTANT — the side named from REPO alone: the corpus\'s own hook runs the public set', () => {
  // The corpus's hook runs THIS repo's runner, so REPO is never the corpus there; only
  // the working directory git runs the hook from names it.
  writeMutant('mutant-side-from-repo.mjs', 'sameRoot(REPO, PRIVATE_ROOT) || sameRoot(process.cwd(), PRIVATE_ROOT)', 'sameRoot(REPO, PRIVATE_ROOT)');
  // Untracked, so the pinned runner stays current (runnerState reads tracked edits only).
  cpSync(join(PUB, 'tooling', 'scripts', 'mutant-side-from-repo.mjs'), join(PINNED_RUNNER(), 'tooling', 'scripts', 'mutant-side-from-repo.mjs'));
  const r = runRunner(PINNED_RUNNER(), 'mutant-side-from-repo.mjs', { cwd: PRIV });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.privateRan, false, 'the mutant still ran the hook:["private"] entry, so the case above is not what proves the side comes from the working directory');
  assert.ok(r.out.includes('hook the public side'), r.out);
});

test('a half-edited declaration in the corpus working tree does not change what a Public commit runs', () => {
  const decl = join(PRIV, ...DECLARATION_REL.split('/'));
  const saved = readFileSync(decl, 'utf8');
  writeFileSync(decl, '{ half-edited, not json\n', 'utf8');
  try {
    const r = runRunner(PUB);
    assert.equal(r.code, 0, `a Public commit must be judged against the corpus's HEAD, not its working tree: ${r.out}`);
    assert.match(r.out, new RegExp(`${GUARD_ROWS.length} guard\\(s\\) in`));
  } finally {
    writeFileSync(decl, saved, 'utf8');
  }
});

test('a committed declaration without a pinned guard is COVERAGE LOST, exit 2, naming the blob and the guard', () => {
  const decl = join(PRIV, ...DECLARATION_REL.split('/'));
  writeFileSync(decl, `${JSON.stringify({ entries: DECLARED.filter((e) => e.id !== 'assert-platform-state') }, null, 2)}\n`, 'utf8');
  git(PRIV, 'commit', '-q', '-am', 'fixture: drop a pinned guard', '--no-gpg-sign');
  try {
    const r = runRunner(PUB);
    assert.equal(r.code, 2, `a declaration that drops a pinned guard must refuse, not run the rest: ${r.out}`);
    assert.match(r.out, /declared guard set could not be used \(limb: pinned\)/);
    assert.match(r.out, /assert-platform-state: not declared/);
    assert.ok(r.out.includes(`HEAD:${DECLARATION_REL}   in ${PRIV}`), `the refusal must name the blob and the root it tried: ${r.out}`);
    assert.doesNotMatch(r.out, /guard\(s\) in \d+ ms/, 'guards ran after the refusal');
  } finally {
    git(PRIV, 'reset', '-q', '--hard', 'HEAD~1');
  }
  // CONTROL — restored, the same run is green, so the refusal was the pin and not the fixture.
  const again = runRunner(PUB);
  assert.equal(again.code, 0, again.out);
});

test('the drift limb: the pinned runner behind origin/main is a finding (1), not a stale pass', () => {
  corpusIsARepo();
  assert.ok(existsSync(PINNED_RUNNER()), 'the previous case did not create the runner, so this case has nothing to judge');
  write(join(PUB, 'moved.txt'), 'origin/main moves\n');
  git(PUB, 'add', 'moved.txt');
  git(PUB, 'commit', '-q', '-m', 'origin/main moves', '--no-gpg-sign');
  git(PUB, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const r = runRunner(PINNED_RUNNER(), 'spec-guards.mjs', { cwd: PRIV, gitDir: join(PRIV, '.git') });
  assert.equal(r.code, 1, `a runner that is not at origin/main must not judge a corpus commit: ${r.out}`);
  assert.match(r.out, /the pinned runner is stale/, r.out);
});

test('the drift limb does not apply to a run from the public repo, whatever branch it is on', () => {
  const r = runRunner(PUB);
  assert.equal(r.code, 0, `a public-repo run must not be judged as a corpus commit: ${r.out}`);
  assert.doesNotMatch(r.out, /RUNNER DRIFT|pinned runner/, r.out);
});
