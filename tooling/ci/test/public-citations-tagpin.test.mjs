// ─────────────────────────────────────────────────────────────────────────────
// public-citations-tagpin.test.mjs — assert-public-citations.mjs must RESOLVE a
// citation pinned to a tag in the private corpus, and must still refuse a plain
// path that no longer exists.
//
// 🔴 THE PROBLEM THIS ANSWERS. The private prune of 2026-09-08 was ordered by the
// owner — "only required only we should keep remaining we can delete it" — and the
// first pass could not finish it: 85 evidence reports, two archive records and one
// fix report STAYED, every one of them held in place by a citation from a public
// record or a public guard comment. Those bytes may not be rewritten to point
// somewhere friendlier (ADR 053 rule 2: a dated record is appended beside, never
// edited), and the guard may not be taught to shrug at a dead path. So an evidence
// pointer was, in effect, a veto over the owner's instruction.
//
// The way out is not to check less. It is to name WHERE the evidence is: the logical
// prefix, a git tag, a colon, and the path the file carried at that tag. Git history
// is the archive, so the citation still resolves — it is simply resolved with
// `git cat-file -e <tag>:<path>` instead of `existsSync`.
//
// ⚠️ WHAT THIS MUST NOT BECOME. A disclosed absence — `(deleted 2026-09-08)` — is a
// promise a reader has to take on trust; this guard accepts those by convention and
// they are exactly the door a pin must not quietly widen. A pin is CHECKED. The three
// cases the fix is worth nothing without are all here, each with its own mutant or
// control:
//
//   1. a pin whose blob IS at the tag RESOLVES        — and the pre-fix guard fails it
//   2. a pin whose path was NEVER at the tag EXITS 1  — the same fixture, one byte of
//                                                       path changed, is the control
//   3. a PLAIN path that no longer exists EXITS 1     — unchanged, and proved unchanged
//
// Plus the two states that are not findings: a pin naming a tag the corpus does not
// carry is COVERAGE LOST (exit 2, never a pass), and a corpus that is not a checkout
// at all still passes a tree that carries NO pin — because git is spawned lazily and a
// tree with nothing to pin must behave exactly as it did before this block existed.
//
// ⚠️ THE FIXTURE IS A REAL TREE, NOT A STUB, for the reason its sibling
// public-citations-shards.test.mjs gives at length: the guard resolves a workspace
// anchor, a repo root, a private corpus and a `git ls-files` subject against a floor of
// 800 tracked files, and a fixture that bypassed any of those would be testing a
// different program. Here the private corpus is a REAL git repository with a REAL tag,
// because the whole claim under test is what git can still prove.
//
// ⏱ APPENDED 2026-09-08 — THE SAME CLAIM, FOR THIS REPOSITORY'S OWN TAGS. Everything
// above is about a citation carrying the `Private/` prefix, resolved against the sibling
// corpus, and that limb could not reach a path INSIDE THIS REPO. The public prune of
// 2026-09-08 needs exactly that: eight files leave the tree and the dated prose naming
// them must keep resolving. So the guard grew a second pin family — this repository's
// own tag namespace, `ref/<tag>:<path>` — resolved by the SAME root-taking
// `resolvesAtTag`, and the cases below are the private set's mirror:
//
//   6. a self-pin whose blob IS at the tag RESOLVES, and the ok line counts it
//   7. a self-pin whose path was NEVER at the tag EXITS 1 — and the pre-limb mutant
//      exits 0 on the same bytes, which is what proves the limb is what bites
//   8. a self-pin naming a tag this repository does not carry is exit 2, never a pass
//
// ⚠️ The self-pin prefix is COMPOSED here for the reason PRIV_PREFIX is composed above,
// and it matters more, not less: a literal self-pin written in this tracked file would be
// resolved against the REAL repository on every hook run, and a fixture tag no real repo
// carries is exit 2 COVERAGE LOST — this file would refuse the tree it is testing.
//
// Run:  node --test "tooling/ci/test/public-citations-tagpin.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // tooling/ci/test -> repo root
const GUARD_SRC = resolve(REPO, 'tooling', 'scripts', 'assert-public-citations.mjs');
const GIT_HELPER_SRC = resolve(REPO, 'tooling', 'scripts', 'repo-git.mjs');
/* The guard imports its ID CITATIONS resolver from here, so the fixture carries it
   beside the guard. The fixture holds no owner id, so that class reads nothing. */
const OWNER_IDS_SRC = resolve(REPO, 'tooling', 'scripts', 'owner-ids.mjs');

/* 🔴 THE LOGICAL PREFIX IS COMPOSED, NEVER WRITTEN WHOLE, and that is not style. This
   file is a TRACKED public file, so the guard scans it as part of its own subject. A
   literal citation here would be resolved against the REAL corpus on every run and
   this test file would start failing the tree it is testing. Its sibling avoids the
   same trap by luck — its fixture citation happens to resolve — and luck is not a
   convention, so this one composes. */
const PRIV_PREFIX = 'Private' + '/';
const FIXTURE_TAG = 'fixture-pre-prune';
const EVIDENCE = 'research/evidence/report-that-was-deleted.md';
const NEVER_THERE = 'research/evidence/report-that-never-existed.md';

/* The PUBLIC half. `ref/` is this repository's tag namespace — every tag it has ever
   carried is `ref/<name>` — and it is what the guard's self-pin matcher keys on. Composed,
   never written whole: see the ⚠️ in the 2026-09-08 append at the head. */
const SELF_NS = 'ref' + '/';
const SELF_TAG = `${SELF_NS}fixture-pre-prune-public`;
const SELF_EVIDENCE = 'docs/record-this-repo-deleted.md';
const SELF_NEVER_THERE = 'docs/record-this-repo-never-had.md';

/* The guard's own floors, READ from the source rather than typed, so that a change to
   either cannot leave this file quietly building a fixture below one and reporting a
   refusal as though it were about pinning. */
const readConst = (name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(readFileSync(GUARD_SRC, 'utf8'));
  assert.ok(m, `assert-public-citations.mjs no longer declares \`const ${name} = <n>;\``);
  return Number(m[1]);
};
const ORIGIN_FLOOR = readConst('ORIGIN_FLOOR');
const FILE_FLOOR = readConst('FILE_FLOOR');

let BASE, PRODUCTS, PUB, PRIV, SPEC;

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

const writeJson = (abs, value) => {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(value, null, 2), 'utf8');
};

const entry = (n) => ({ id: `INV-${n}`, claim: `fixture claim ${n}`, origin: `[2]C-${n}` });

/** The private corpus: a spec fat enough to clear the origin floor, a real git
 *  repository, a tag taken WITH the evidence file present, and then the evidence file
 *  deleted and committed. That last step is the whole point — after it the path is not
 *  on disk and IS at the tag, which is exactly the state the prune leaves behind. */
function buildPinnedCorpus({ commitTheDeletion = true, keepGit = true } = {}) {
  rmSync(PRIV, { recursive: true, force: true });
  mkdirSync(SPEC, { recursive: true });
  writeJson(join(SPEC, 'index.json'), { registers: { 'invariants.json': { kind: 'invariant' } } });
  writeJson(join(SPEC, 'invariants.json'), Array.from({ length: ORIGIN_FLOOR + 20 }, (_, i) => entry(i + 1)));
  mkdirSync(dirname(join(PRIV, EVIDENCE)), { recursive: true });
  writeFileSync(join(PRIV, EVIDENCE), '# fixture evidence, deleted by the prune\n', 'utf8');

  git(PRIV, 'init', '-q');
  git(PRIV, 'config', 'user.email', 'fixture@example.test');
  git(PRIV, 'config', 'user.name', 'fixture');
  git(PRIV, 'config', 'commit.gpgsign', 'false');
  git(PRIV, 'add', '-A');
  git(PRIV, 'commit', '-q', '-m', 'evidence before prune', '--no-gpg-sign');
  git(PRIV, 'tag', FIXTURE_TAG);

  if (commitTheDeletion) {
    git(PRIV, 'rm', '-q', '--', EVIDENCE);
    git(PRIV, 'commit', '-q', '-m', 'the prune', '--no-gpg-sign');
    assert.ok(!existsSync(join(PRIV, EVIDENCE)), 'the evidence file is still on disk, so a pass below would prove nothing');
  }
  if (!keepGit) rmSync(join(PRIV, '.git'), { recursive: true, force: true });
}

function runGuard(file = 'assert-public-citations.mjs') {
  const env = { ...process.env };
  delete env.NIKATRU_PRIVATE_ROOT;
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(PUB, 'tooling', 'scripts', file)], { cwd: PUB, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** The mutant: the guard with the `TAG PIN USE BEGIN … END` region deleted, which is
 *  the guard exactly as it stood before 2026-09-08. The RESOLVER block is deliberately
 *  left in place — what a case below measures is that the pin is REACHED, not merely
 *  that the source got shorter. */
/** The PUBLIC mutant: the guard with the `SELF PIN USE BEGIN … END` region deleted,
 *  which is the guard exactly as it stood before the public limb landed. With the region
 *  gone a self-pin is not MATCHED at all, so the mutant exits 0 where the guard exits 1 —
 *  the pre-fix behaviour was not a wrong answer, it was NO answer, and that is precisely
 *  the hole § 5.1 of the prune plan named. The RESOLVER is left in place on purpose: what
 *  the case measures is that the self-pin is REACHED, not that the source got shorter. */
function writeNoSelfPinMutant() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const begin = src.indexOf('/* ── SELF PIN USE BEGIN');
  const end = src.indexOf('SELF PIN USE END', begin);
  assert.notEqual(begin, -1, 'the SELF PIN USE BEGIN marker is gone from the guard — this file can no longer build its public mutant, and the "the public limb matters" case below would be asserting nothing');
  assert.notEqual(end, -1, 'the SELF PIN USE END marker is gone from the guard');
  const endOfLine = src.indexOf('\n', end);
  const mutant = src.slice(0, begin) + src.slice(endOfLine + 1);
  assert.ok(!mutant.includes('resolvesAtTag(REPO,'), 'the mutation left the self-pin resolution in the scan loop');
  assert.ok(mutant.includes('resolvesAtTag(PRIVATE,'), 'the mutation also removed the PRIVATE pin limb, so a red below would not be about the public one');
  assert.notEqual(mutant, src, 'the mutation changed nothing');
  writeFileSync(join(PUB, 'tooling', 'scripts', 'mutant-no-self-pin.mjs'), mutant, 'utf8');
}

function writeNoPinMutant() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const begin = src.indexOf('/* ── TAG PIN USE BEGIN');
  const end = src.indexOf('TAG PIN USE END', begin);
  assert.notEqual(begin, -1, 'the TAG PIN USE BEGIN marker is gone from the guard — this file can no longer build its mutant, and every "the fix matters" case below would be asserting nothing');
  assert.notEqual(end, -1, 'the TAG PIN USE END marker is gone from the guard');
  const endOfLine = src.indexOf('\n', end);
  const mutant = src.slice(0, begin) + src.slice(endOfLine + 1);
  assert.ok(!mutant.includes('resolvesAtTag(PRIVATE, pinned['), 'the mutation left the pin resolution in the path limb');
  assert.notEqual(mutant, src, 'the mutation changed nothing');
  writeFileSync(join(PUB, 'tooling', 'scripts', 'mutant-no-pin.mjs'), mutant, 'utf8');
}

/** Stage a tracked public file for one case and take it out again. Tracked, because
 *  this guard's subject is `git ls-files`: an untracked file is not part of it and a
 *  case that wrote one would be scanning nothing. */
function withTrackedFile(rel, body, fn) {
  const abs = join(PUB, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
  git(PUB, 'add', '--', rel);
  try {
    assert.ok(git(PUB, 'ls-files', '--', rel).includes(rel), 'the citing file is not in the fixture index, so the guard will never scan it');
    return fn();
  } finally {
    git(PUB, 'rm', '-q', '-f', '--cached', '--', rel);
    rmSync(abs, { force: true });
  }
}

const CITING_FILE = 'docs/cites-pruned-evidence.md';
/** A dated record naming a file the prune removed — the shape the real tree carries
 *  in twelve files, and the shape ADR 053 rule 2 forbids rewriting into prose. */
const citing = (cited) => [
  '# fixture: a dated record naming evidence that was pruned',
  '',
  `As of 2026-09-01 the failure below was measured and written up in`,
  `${cited}.`,
  '',
].join('\n');

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-tagpin-'));
  PRODUCTS = join(BASE, 'Projects');
  PUB = join(PRODUCTS, 'Fixture_Public');
  PRIV = join(PRODUCTS, 'Fixture_Private');
  SPEC = join(PRIV, 'requirements');

  mkdirSync(join(BASE, 'nikatru'), { recursive: true });
  writeFileSync(join(BASE, 'nikatru', 'README.md'), 'the shared business brain, fixture\n', 'utf8');

  mkdirSync(join(PUB, 'filler'), { recursive: true });
  const tracked = FILE_FLOOR + 10;
  for (let i = 0; i < tracked; i += 1) writeFileSync(join(PUB, 'filler', `f-${i}.txt`), `filler ${i}\n`, 'utf8');
  git(PUB, 'init', '-q');
  git(PUB, 'config', 'user.email', 'fixture@example.test');
  git(PUB, 'config', 'user.name', 'fixture');
  git(PUB, 'config', 'commit.gpgsign', 'false');
  git(PUB, 'add', '-A');
  git(PUB, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  /* THE PUBLIC PIN'S OWN HISTORY, built in the FIXTURE PUBLIC REPO rather than the
     corpus: a file committed, tagged with this repository's `ref/` convention, then
     deleted and committed. After it the path is not on disk and IS at the tag — the
     state the prune leaves behind, one repository closer to home than the private half. */
  mkdirSync(dirname(join(PUB, SELF_EVIDENCE)), { recursive: true });
  writeFileSync(join(PUB, SELF_EVIDENCE), '# fixture record, deleted by the public prune\n', 'utf8');
  git(PUB, 'add', '--', SELF_EVIDENCE);
  git(PUB, 'commit', '-q', '-m', 'the record, before the public prune', '--no-gpg-sign');
  git(PUB, 'tag', SELF_TAG);
  git(PUB, 'rm', '-q', '--', SELF_EVIDENCE);
  git(PUB, 'commit', '-q', '-m', 'the public prune', '--no-gpg-sign');
  assert.ok(!existsSync(join(PUB, SELF_EVIDENCE)), 'the self-pinned file is still on disk, so a pass below would prove nothing');

  /* Copied in AFTER the commit and left UNTRACKED: the guard's subject is
     `git ls-files`, so an untracked copy is not part of its own subject. */
  mkdirSync(join(PUB, 'tooling', 'scripts'), { recursive: true });
  cpSync(GUARD_SRC, join(PUB, 'tooling', 'scripts', 'assert-public-citations.mjs'));
  cpSync(GIT_HELPER_SRC, join(PUB, 'tooling', 'scripts', 'repo-git.mjs'));
  cpSync(OWNER_IDS_SRC, join(PUB, 'tooling', 'scripts', 'owner-ids.mjs'));
  writeNoPinMutant();
  writeNoSelfPinMutant();

  assert.equal(git(PUB, 'ls-files').split('\n').filter(Boolean).length, tracked, 'the fixture repo does not track the number of files this file thinks it does');
});

after(() => { rmSync(BASE, { recursive: true, force: true }); });

test('a citation pinned to a tag RESOLVES, and the pre-fix guard proves it could not', () => {
  buildPinnedCorpus();

  // CONTROL: with no citation in the tree the corpus is green, so every exit code
  // below is about the citing file and nothing else.
  assert.equal(runGuard().code, 0, 'the fixture corpus is not green before the citing file is added');

  withTrackedFile(CITING_FILE, citing(`${PRIV_PREFIX}${FIXTURE_TAG}:${EVIDENCE}`), () => {
    const real = runGuard();
    assert.equal(real.code, 0, `a pin whose blob is at the tag must resolve: ${real.out}`);
    assert.match(real.out, /every citation resolves/);
    assert.match(real.out, /1 of them tag-pinned/, `the ok line must say how many pins were resolved, so a reader can check it. Got: ${real.out}`);

    // MUTANT — the same fixture read by the guard with the pin region deleted. This is
    // the measured problem rebuilt: the file is gone, the evidence is in history, and
    // the pre-fix guard can only call it a dead path.
    const old = runGuard('mutant-no-pin.mjs');
    assert.equal(old.code, 1, `without the pin region the citation must fail, or this case is not exercising the fix: ${old.out}`);
    assert.match(old.out, /no such path/);
  });
});

test('a pin to a path that was NEVER at the tag is exit 1 — a pin is resolved, not believed', () => {
  buildPinnedCorpus();

  withTrackedFile(CITING_FILE, citing(`${PRIV_PREFIX}${FIXTURE_TAG}:${NEVER_THERE}`), () => {
    const real = runGuard();
    assert.equal(real.code, 1, `a pin naming a path that is not at the tag must FAIL: ${real.out}`);
    assert.match(real.out, /not at that tag/, `the finding must say what was wrong with it. Got: ${real.out}`);
    assert.ok(real.out.includes(NEVER_THERE), `the finding must name the cited path. Got: ${real.out}`);
  });

  /* CONTROL — the SAME corpus and the SAME shape of citation, differing only in which
     path is named. It resolves. So the exit 1 above is about the path not being at the
     tag, and not about the pin syntax, the corpus, or the fixture. */
  withTrackedFile(CITING_FILE, citing(`${PRIV_PREFIX}${FIXTURE_TAG}:${EVIDENCE}`), () => {
    const control = runGuard();
    assert.equal(control.code, 0, `the control citation must resolve, or the case above proves only that this fixture is red: ${control.out}`);
  });
});

test('a PLAIN path that no longer exists is still exit 1 — the pin block did not soften the old limb', () => {
  buildPinnedCorpus();

  withTrackedFile(CITING_FILE, citing(`${PRIV_PREFIX}${EVIDENCE}`), () => {
    const real = runGuard();
    assert.equal(real.code, 1, `an unpinned path that is gone from disk must still fail — a pin is opt-in, per citation, and never a tree-wide amnesty: ${real.out}`);
    assert.match(real.out, /no such path/);
    assert.ok(real.out.includes(EVIDENCE), `the finding must name the cited path. Got: ${real.out}`);

    /* And the pre-fix guard agrees, byte for byte. A case where the mutant and the
       guard behave IDENTICALLY is the one that proves this change altered nothing it
       did not claim to alter. */
    const old = runGuard('mutant-no-pin.mjs');
    assert.equal(old.code, 1, `the pre-fix guard must reach the same verdict on a plain dead path: ${old.out}`);
  });
});

test('a pin naming a tag the corpus does not carry is exit 2, never a pass', () => {
  buildPinnedCorpus();

  withTrackedFile(CITING_FILE, citing(`${PRIV_PREFIX}no-such-tag-here:${EVIDENCE}`), () => {
    const real = runGuard();
    assert.equal(real.code, 2, `an unresolvable TAG is COVERAGE LOST — the citation was not evaluated, and "I could not check" must not share an exit code with "it checks out": ${real.out}`);
    assert.match(real.out, /does not carry/);
    assert.ok(real.out.includes('no-such-tag-here'), `the refusal must name the tag it could not find. Got: ${real.out}`);
  });
});

test('git is spawned LAZILY — a corpus that is not a checkout still passes a tree with no pin, and refuses one with', () => {
  /* The corpus is built, the deletion is NOT committed (so the file is on disk) and
     `.git` is removed. A tree carrying no pin must behave exactly as it did before the
     pin block existed, including here. */
  buildPinnedCorpus({ commitTheDeletion: false, keepGit: false });
  assert.ok(existsSync(join(PRIV, EVIDENCE)), 'the evidence file must be on disk for the unpinned half of this case');
  assert.ok(!existsSync(join(PRIV, '.git')), 'the corpus must not be a checkout for this case to mean anything');

  withTrackedFile(CITING_FILE, citing(`${PRIV_PREFIX}${EVIDENCE}`), () => {
    const real = runGuard();
    assert.equal(real.code, 0, `a plain path on disk must resolve without git being spawned at all: ${real.out}`);
    assert.match(real.out, /0 of them tag-pinned/);
  });

  withTrackedFile(CITING_FILE, citing(`${PRIV_PREFIX}${FIXTURE_TAG}:${EVIDENCE}`), () => {
    const real = runGuard();
    assert.equal(real.code, 2, `a pin against a corpus git cannot read is COVERAGE LOST: ${real.out}`);
    assert.match(real.out, /could not be evaluated/);
  });
});

test('a self-pin to THIS repository\'s own tag RESOLVES, and the ok line counts it', () => {
  buildPinnedCorpus();

  // CONTROL: green with no citing file, so every exit code below is about that file alone.
  assert.equal(runGuard().code, 0, 'the fixture is not green before the citing file is added');

  withTrackedFile(CITING_FILE, citing(`${SELF_TAG}:${SELF_EVIDENCE}`), () => {
    const real = runGuard();
    assert.equal(real.code, 0, `a self-pin whose blob is at the tag must resolve: ${real.out}`);
    assert.match(real.out, /every citation resolves/);
    assert.match(real.out, /1 self-pin\(s\)/, `the ok line must say how many self-pins were resolved, so a reader can check it. Got: ${real.out}`);
  });
});

test('a self-pin to a path that was NEVER at the tag is exit 1 — and the pre-limb guard did not even look', () => {
  buildPinnedCorpus();

  withTrackedFile(CITING_FILE, citing(`${SELF_TAG}:${SELF_NEVER_THERE}`), () => {
    const real = runGuard();
    assert.equal(real.code, 1, `a self-pin naming a path that is not at the tag must FAIL: ${real.out}`);
    assert.match(real.out, /not at that tag in this repository/, `the finding must say what was wrong with it. Got: ${real.out}`);
    assert.ok(real.out.includes(SELF_NEVER_THERE), `the finding must name the cited path. Got: ${real.out}`);

    /* THE MUTATION. The same bytes read by the guard with the SELF PIN USE region gone
       exit 0 — not a wrong verdict, NO verdict, because before this limb a repo-local
       citation matched nothing at all. That is the hole, put back and watched. */
    const old = runGuard('mutant-no-self-pin.mjs');
    assert.equal(old.code, 0, `without the self-pin region the citation must go unchecked, or this case is not exercising the fix: ${old.out}`);
    assert.doesNotMatch(old.out, /not at that tag in this repository/);
  });

  /* CONTROL — the SAME fixture and the SAME shape of citation, differing only in which
     path is named. It resolves. So the exit 1 above is about the path not being at the
     tag, and not about the pin syntax, the fixture, or the tag. */
  withTrackedFile(CITING_FILE, citing(`${SELF_TAG}:${SELF_EVIDENCE}`), () => {
    const control = runGuard();
    assert.equal(control.code, 0, `the control citation must resolve, or the case above proves only that this fixture is red: ${control.out}`);
  });
});

test('a self-pin naming a tag THIS repository does not carry is exit 2, never a pass', () => {
  buildPinnedCorpus();

  withTrackedFile(CITING_FILE, citing(`${SELF_NS}no-such-tag-here:${SELF_EVIDENCE}`), () => {
    const real = runGuard();
    assert.equal(real.code, 2, `an unresolvable TAG is COVERAGE LOST — the citation was not evaluated, and "I could not check" must not share an exit code with "it checks out": ${real.out}`);
    assert.match(real.out, /does not carry/);
    assert.ok(real.out.includes('no-such-tag-here'), `the refusal must name the tag it could not find. Got: ${real.out}`);
    assert.ok(real.out.includes(PUB), `the refusal must name the repository it asked, or a reader cannot tell which of the two corpora failed. Got: ${real.out}`);
  });
});

test('the self-pin matcher does not fire on ordinary prose', () => {
  buildPinnedCorpus();

  /* Every line here contains a colon after a slashed token, which is what a naive
     `<tag>:<path>` matcher would have claimed as a citation. None of them is one. */
  const prose = [
    '# fixture: prose that is not a citation',
    '',
    'See tooling/ci/assert-thing.mjs:214 for the limb that does this.',
    'note: docs/areas/history.md records the window.',
    'The href/link:target shape is not a pin either.',
    'https://example.test/ref/whatever:not-a-pin',
    '',
  ].join('\n');

  withTrackedFile(CITING_FILE, prose, () => {
    const real = runGuard();
    assert.equal(real.code, 0, `ordinary prose must not be read as a self-pin: ${real.out}`);
    assert.match(real.out, /0 self-pin\(s\)/, `nothing on those lines is a citation, so the count must be zero. Got: ${real.out}`);
  });
});

test('the fixture guard file is the committed one, byte for byte', () => {
  assert.equal(
    readFileSync(join(PUB, 'tooling', 'scripts', 'assert-public-citations.mjs'), 'utf8'),
    readFileSync(GUARD_SRC, 'utf8'),
    'the copy under test has drifted from the guard in the tree, so every case above is about a file nothing ships',
  );
  assert.ok(existsSync(join(PUB, 'tooling', 'scripts', 'repo-git.mjs')), 'the git helper is missing from the fixture repo');
});
