// ─────────────────────────────────────────────────────────────────────────────
// public-citations-ids.test.mjs — the ROW IDS class of assert-public-citations.mjs:
// an O- or P- id in a tracked line resolves against Private's registers, whatever
// the row's state, and a state phrase beside such an id is refused.
//
// 🔴 THE DEFECT, MEASURED BEFORE THIS FILE EXISTED (O-PUBLIC-DOCS-HAND-WRITTEN-FACTS).
// A public doc said a row stayed open after the row had closed in Private, and every
// guard was green: nothing read a public line against the register it cites. Other
// public lines cited ids no register carries. D4 and D5 below are those two trees
// rebuilt, and their mutant is the guard before the class existed.
//
// ── THE CASES ────────────────────────────────────────────────────────────────
//   D4   an O- id no row carries                             -> 1, naming file:line and the id
//   D5   a state phrase beside a CLOSED row's id             -> 1, in the one-line format
//   D5b  a state phrase beside an OPEN row's id              -> 1: the limb reads no state
//   D6   a closed row, an open row and a programme item      -> 0: never filtered by state
//   D6b  a P- id no programme item carries                   -> 1
//   D6c  an unresolved id with a disclosed absence, and one struck through -> 0
//   D6d  an id wrapped at a line end                         -> resolved whole
//   D6e  an O- id cited and open.json absent                 -> 2 COVERAGE LOST
//   Each is written out by hand; none is declared in a loop.
//
// ⚠️ EVERY FIXTURE ID IS BUILT FROM PARTS (`rowId(...)`). This file is a tracked
// public file, so the class reads it on the real tree: a literal fixture id here
// would be an unresolved citation, and a literal id beside a state phrase a state
// claim. The same goes for every comment in it.
//
// ⚠️ THE FIXTURE IS A REAL WORKSPACE, as in public-citations-owner-ids.test.mjs: the
// anchor (`Projects/` + `nikatru/`), a public repo over the tracked-file floor, and
// a `_Private` sibling carrying a spec over the origin floor and the two registers.
//
// Run:  node --single-threaded --test tooling/ci/test/public-citations-ids.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD_SRC = resolve(REPO, 'tooling', 'scripts', 'assert-public-citations.mjs');
const GIT_HELPER_SRC = resolve(REPO, 'tooling', 'scripts', 'repo-git.mjs');
const OWNER_IDS_SRC = resolve(REPO, 'tooling', 'scripts', 'owner-ids.mjs');

/* The guard's own floors, read from its source so the fixture cannot quietly sit
   below one and report a floor refusal as if it were about row ids. */
const readConst = (name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(readFileSync(GUARD_SRC, 'utf8'));
  assert.ok(m, `assert-public-citations.mjs no longer declares \`const ${name} = <n>;\``);
  return Number(m[1]);
};
const ORIGIN_FLOOR = readConst('ORIGIN_FLOOR');
const FILE_FLOOR = readConst('FILE_FLOOR');

/** An id assembled from its parts, so no id is written in this file's source. */
const rowId = (...parts) => parts.join('-');
const OPEN_ROW = rowId('O', 'FIXTURE', 'OPEN', 'ROW');
const CLOSED_ROW = rowId('O', 'FIXTURE', 'CLOSED', 'ROW');
const NO_ROW = rowId('O', 'FIXTURE', 'NO', 'SUCH', 'ROW');
const ITEM = rowId('P9', '1');
const NO_ITEM = rowId('P9', '2');
const DOC = 'docs/ids.md';
const ST_WHY = '"state lives in the Private register; cite the id only"';

let BASE, PUB, PRIV, OPEN_JSON, PROGRAMME_JSON;

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

const writeJson = (abs, value) => {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

/** One open row and one closed row, shaped as the owner-ids fixture shapes them. */
function setOpen(present = true) {
  rmSync(OPEN_JSON, { force: true });
  if (!present) return;
  writeJson(OPEN_JSON, {
    _readme: 'fixture open register',
    rows: [
      { id: OPEN_ROW, owner: 'agent', state: 'open', closedOn: null, what: 'fixture row, open' },
      { id: CLOSED_ROW, owner: 'agent', state: 'done', closedOn: '2026-09-01', what: 'fixture row, closed' },
    ],
  });
}

/** The tracked doc's text for one case. Tracked once in `before`; each case rewrites
 *  the working-tree bytes, which is what the guard reads. */
const setDoc = (text) => writeFileSync(join(PUB, DOC), text, 'utf8');

/** Run a guard file from the fixture repo, with the machine's root overrides and the
 *  six redirecting git variables removed, or a case would resolve against the REAL
 *  corpus and pass over nothing. */
function runGuard(file = 'assert-public-citations.mjs') {
  const env = { ...process.env };
  delete env.NIKATRU_PRIVATE_ROOT;
  delete env.NIKATRU_BUSINESS_ROOT;
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(PUB, 'tooling', 'scripts', file)], { cwd: PUB, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** The mutant: the guard with the `ROW IDS BEGIN … END` block deleted, which is the
 *  guard as it stood before this class existed. */
function writeNoClassMutant() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const begin = src.indexOf('/* ── ROW IDS BEGIN');
  const end = src.indexOf('ROW IDS END', begin);
  assert.notEqual(begin, -1, 'the ROW IDS BEGIN marker is gone from the guard, so no mutant can be built and every "the class bites" case would assert nothing');
  assert.notEqual(end, -1, 'the ROW IDS END marker is gone from the guard');
  const mutant = src.slice(0, begin) + src.slice(src.indexOf('\n', end) + 1);
  assert.ok(!mutant.includes('RE_STATE_WORDS'), 'the mutant still reads state words, so the region deleted was not the one doing the work');
  writeFileSync(join(PUB, 'tooling', 'scripts', 'mutant-no-row-ids.mjs'), mutant, 'utf8');
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-row-ids-'));
  const products = join(BASE, 'Projects');
  PUB = join(products, 'Fixture_Public');
  PRIV = join(products, 'Fixture_Private');
  OPEN_JSON = join(PRIV, 'platform-state', 'open.json');
  PROGRAMME_JSON = join(PRIV, 'platform-state', 'programme.json');

  mkdirSync(join(BASE, 'nikatru'), { recursive: true });
  writeFileSync(join(BASE, 'nikatru', 'README.md'), 'the shared business brain, fixture\n', 'utf8');

  const spec = join(PRIV, 'requirements');
  writeJson(join(spec, 'index.json'), { registers: { 'invariants.json': { kind: 'invariant' } } });
  writeJson(
    join(spec, 'invariants.json'),
    Array.from({ length: ORIGIN_FLOOR + 20 }, (_, i) => ({ id: `INV-${i + 1}`, claim: `fixture claim ${i + 1}`, origin: `[2]C-${i + 1}` })),
  );
  setOpen(true);
  writeJson(PROGRAMME_JSON, { _readme: 'fixture programme', phases: [{ id: 'P9', items: [{ id: ITEM, state: 'in-flight', what: 'fixture item' }] }] });

  mkdirSync(join(PUB, 'filler'), { recursive: true });
  for (let i = 0; i < FILE_FLOOR + 10; i += 1) writeFileSync(join(PUB, 'filler', `f-${i}.txt`), `filler ${i}\n`, 'utf8');
  mkdirSync(join(PUB, 'docs'), { recursive: true });
  setDoc('# ids\n\nNothing cited yet.\n');
  git(PUB, 'init', '-q');
  git(PUB, 'config', 'user.email', 'fixture@example.test');
  git(PUB, 'config', 'user.name', 'fixture');
  git(PUB, 'config', 'commit.gpgsign', 'false');
  git(PUB, 'add', '-A');
  git(PUB, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  /* Copied in untracked, as the sibling suites do: the guard's subject is
     `git ls-files`, and its own source is not part of the fixture's subject. */
  mkdirSync(join(PUB, 'tooling', 'scripts'), { recursive: true });
  cpSync(GUARD_SRC, join(PUB, 'tooling', 'scripts', 'assert-public-citations.mjs'));
  cpSync(GIT_HELPER_SRC, join(PUB, 'tooling', 'scripts', 'repo-git.mjs'));
  cpSync(OWNER_IDS_SRC, join(PUB, 'tooling', 'scripts', 'owner-ids.mjs'));
  writeNoClassMutant();
});

after(() => { rmSync(BASE, { recursive: true, force: true }); });

describe('the ROW IDS class, over a fixture workspace', () => {
  test('green control: a tree citing no id reads no register and passes', () => {
    setDoc('# ids\n\nNothing cited yet.\n');
    const r = runGuard();
    assert.equal(r.code, 0, `green control first, or every red case below proves nothing: ${r.out}`);
    assert.match(r.out, /0 O-\/P- row id\(s\) on 0 line\(s\)/, `the run must say what the class read: ${r.out}`);
  });

  test('D4 — an O- id no row carries is exit 1, naming the file, the line and the id; the guard without the class passes it', () => {
    setDoc(`# ids\n\nThe fix is tracked as ${NO_ROW}.\n`);
    const r = runGuard();
    assert.equal(r.code, 1, `an id no row carries must fail: ${r.out}`);
    assert.ok(r.out.includes(DOC), `the finding must name the file: ${r.out}`);
    assert.match(r.out, new RegExp(`:3 {2}no row of open\\.json carries it {2}${NO_ROW}`), `the finding must name the line and the id: ${r.out}`);

    const old = runGuard('mutant-no-row-ids.mjs');
    assert.equal(old.code, 0, `without the class the same tree passed — that is the defect: ${old.out}`);
  });

  test('D5 — a state phrase beside a CLOSED row\'s id is exit 1, in the one-line format; the guard without the class passes it', () => {
    setDoc(`# ids\n\nThe freshness guard grades recency. ${CLOSED_ROW} stays open.\n`);
    const r = runGuard();
    assert.equal(r.code, 1, `a state claim beside an id must fail: ${r.out}`);
    assert.ok(r.out.includes(`${DOC}:3 — ${CLOSED_ROW} — stays open — ${ST_WHY}`), `the finding must print file:line — id — the words — the reason: ${r.out}`);
    assert.doesNotMatch(r.out, /no row of open\.json carries it/, 'the closed row resolves; only the state words are the finding');

    const old = runGuard('mutant-no-row-ids.mjs');
    assert.equal(old.code, 0, `without the class the same tree passed — that is the defect: ${old.out}`);
  });

  test('D5b — the same phrase beside an OPEN row\'s id is exit 1 too: the limb reads no row state', () => {
    setDoc(`# ids\n\nUntil the owner acts, ${OPEN_ROW} is open.\n`);
    const r = runGuard();
    assert.equal(r.code, 1, `a true state claim is still a claim the register owns: ${r.out}`);
    assert.ok(r.out.includes(`${DOC}:3 — ${OPEN_ROW} — is open — ${ST_WHY}`), r.out);
  });

  test('D6 — a closed row, an open row and a programme item, cited plainly, pass: nothing is filtered by state', () => {
    setDoc(`# ids\n\nSee ${CLOSED_ROW} and ${OPEN_ROW}.\n\nProgramme item ${ITEM} names it.\n`);
    const r = runGuard();
    assert.equal(r.code, 0, `every cited id has a row, whatever its state: ${r.out}`);
    assert.match(r.out, /3 O-\/P- row id\(s\) on 2 line\(s\), resolved against every row of open\.json \(2\) and programme\.json \(1\)/, r.out);
  });

  test('D6b — a P- id no programme item carries is exit 1', () => {
    setDoc(`# ids\n\nProgramme item ${NO_ITEM} names it.\n`);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`:3 {2}no row of programme\\.json carries it {2}${NO_ITEM}`), r.out);
  });

  test('D6c — a disclosed absence and a struck-through id pass, by the path class\'s conventions', () => {
    setDoc(`# ids\n\nOnce tracked as ${NO_ROW} (never existed).\n\n~~Tracked as ${NO_ROW}.~~ Now tracked as ${OPEN_ROW}.\n`);
    const r = runGuard();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 disclosed absence\(s\)/, r.out);
  });

  test('D6d — an id wrapped at a line end resolves whole, not as its first half', () => {
    const [head, tail] = [rowId('O', 'FIXTURE', 'CLOSED'), 'ROW'];
    setDoc(`# ids\n\n// the row (${head}-\n// ${tail}) is the record.\n`);
    const r = runGuard();
    assert.equal(r.code, 0, `the wrapped id is ${CLOSED_ROW}, which has a row: ${r.out}`);
  });

  test('D6e — an O- id cited with open.json absent is exit 2 COVERAGE LOST, never a pass', () => {
    setDoc(`# ids\n\nSee ${OPEN_ROW}.\n`);
    setOpen(false);
    try {
      const r = runGuard();
      assert.equal(r.code, 2, `an id nobody could look up has not been checked: ${r.out}`);
      assert.match(r.out, /the ROW IDS class could not read what it resolves against/, r.out);
    } finally {
      setOpen(true);
    }
    assert.equal(runGuard().code, 0, 'restored, the fixture must be green again');
  });
});

test('the fixture guard file is the committed one, byte for byte', () => {
  assert.equal(
    readFileSync(join(PUB, 'tooling', 'scripts', 'assert-public-citations.mjs'), 'utf8'),
    readFileSync(GUARD_SRC, 'utf8'),
    'the copy under test has drifted from the guard in the tree, so every case above is about a file nothing ships',
  );
});
