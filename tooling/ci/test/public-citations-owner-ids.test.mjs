// ─────────────────────────────────────────────────────────────────────────────
// public-citations-owner-ids.test.mjs — the ID CITATIONS class of
// assert-public-citations.mjs, and the resolver it imports from
// tooling/scripts/owner-ids.mjs.
//
// 🔴 THE DEFECT, MEASURED BEFORE THIS FILE EXISTED (apps-review F1). The clearance
// record held its trademark block on an owner id whose row was never
// opened, and every guard was green: limb 7 of assert-name-clearance.mjs checks that
// `ownerItem` is PRESENT, and nothing asked whether the row it names EXISTS. RC1
// below is that tree rebuilt, and its mutant is the guard before the class existed.
//
// ── THE CASES, AS THE BRIEF NUMBERS THEM ─────────────────────────────────────
//   RC1   a held id with no row                               -> 1, naming the id
//   RC2   a closed row, the subject changed on this branch    -> 1
//   RC2b  a closed row, the subject NOT changed               -> 0, `STALE HOLD`
//   RC2c  RC2b under --all-subjects                           -> 1
//   RC3   an owner ruling carried by an agent row, changed    -> 1
//   RC4   an owner-queue id, the business root absent         -> 2
//   ⏱ 2026-09-24, from the PR 913 review:
//   M1    a live owner row that never names the subject       -> 1, UNRELATED
//         (the review's `O-KEY-ESCROW`; the resolver before it said `live`)
//   L1    an id is looked up in BOTH registers: a queue id of open.json's shape
//         resolves from the queue, one both carry is AMBIGUOUS -> 1
//   L3    a duplicate held id, a register with zero rows, an unparseable subject
//         -> 2 each; case and whitespace variants of a real id -> 1 each; a
//         recorded ruling beside its old id holds nothing       -> 0
//   Each is written out by hand; none is declared in a loop.
//
// ⚠️ THE FIXTURE IS A REAL WORKSPACE, as in public-citations-shards.test.mjs: the
// anchor (`Projects/` + `nikatru/`), a public repo over the tracked-file floor, a
// `_Private` sibling carrying a spec over the origin floor, and an `origin/main` ref
// so the merge-base limb has something to measure. A fixture that bypassed any of
// those would be testing a different program.
//
// Run:  node --single-threaded --test tooling/ci/test/public-citations-owner-ids.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { idClass, isOwnerId, indexRows, resolveHold, holdsIn, subjectFor, subjectText, HOLD_SUBJECTS } from '../../scripts/owner-ids.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD_SRC = resolve(REPO, 'tooling', 'scripts', 'assert-public-citations.mjs');
const GIT_HELPER_SRC = resolve(REPO, 'tooling', 'scripts', 'repo-git.mjs');
const OWNER_IDS_SRC = resolve(REPO, 'tooling', 'scripts', 'owner-ids.mjs');

/* The guard's own floors, read from its source so the fixture cannot quietly sit
   below one and report a floor refusal as if it were about owner ids. */
const readConst = (name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(readFileSync(GUARD_SRC, 'utf8'));
  assert.ok(m, `assert-public-citations.mjs no longer declares \`const ${name} = <n>;\``);
  return Number(m[1]);
};
const ORIGIN_FLOOR = readConst('ORIGIN_FLOOR');
const FILE_FLOOR = readConst('FILE_FLOOR');

const SUBJECT = 'apps/fixture/name-clearance.json';
/* Built from parts: a literal fixture id in this tracked file is a citation the
   guard's ROW IDS class would look up in open.json. */
const HELD = ['O', 'FIXTURE', 'TRADEMARK', 'HOLD'].join('-');
/* The same for every other fixture id below: the ROW IDS class looks an O- id
   up in open.json, and none of these is a row there. */
const ID_SUBLY = ['O', 'NAME', 'SUBLY', 'TRADEMARK'].join('-');
const ID_ADDR = ['O', 'ADDR', 'PUBLISH'].join('-');
const ID_OLD_RULING = ['O', 'OLD', 'RULING', 'ROW'].join('-');
const ID_BY_BLOCKS = ['O', 'BY', 'BLOCKS'].join('-');
const ID_BY_CLOSES = ['O', 'BY', 'CLOSES'].join('-');
const ID_BY_WHAT = ['O', 'BY', 'WHAT'].join('-');
const ID_BOTH = ['O', 'BOTH', 'PLACES'].join('-');
const ID_NOPE = ['O', 'NOPE', 'NOPE'].join('-');

let BASE, PUB, PRIV, OPEN_JSON, QUEUE_JSON;

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

const writeJson = (abs, value) => {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

/** The subject, shaped like the real record's trademark block. `edited` changes a
 *  byte the class does not read, so "the subject changed" never means "the id changed".
 *  `ruling` is the answer the hold waits on; a recorded one ends the hold. */
const subjectDoc = (ownerItem, { edited = false, ruling = null } = {}) => ({
  app: 'fixture',
  trademark: {
    signals: edited ? ['fixture signal, edited on this branch'] : [],
    ruling,
    ruledBy: ruling === null ? null : 'owner',
    ruledOn: ruling === null ? null : '2026-09-09',
    ownerItem,
    gatedUntil: ownerItem === null || ruling !== null ? null : '2099-01-01',
  },
});

/** Commit `text` as the subject and point `origin/main` at that commit, so the
 *  subject is identical to the merge-base. */
function commitSubject(text, message) {
  mkdirSync(dirname(join(PUB, SUBJECT)), { recursive: true });
  writeFileSync(join(PUB, SUBJECT), text, 'utf8');
  git(PUB, 'add', '--', SUBJECT);
  git(PUB, 'commit', '-q', '--allow-empty', '-m', message, '--no-gpg-sign');
  git(PUB, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
}

/** Commit the subject holding `ownerItem`. `changed` then edits the working tree,
 *  which is what a branch in a pre-commit hook looks like. */
function setSubject(ownerItem, { changed = false, ruling = null } = {}) {
  commitSubject(`${JSON.stringify(subjectDoc(ownerItem, { ruling }), null, 2)}\n`, `hold ${ownerItem}`);
  if (changed) writeJson(join(PUB, SUBJECT), subjectDoc(ownerItem, { edited: true, ruling }));
}

/** An open.json row. By default its `closes` names the subject file, which is what
 *  makes a live row a hold on THIS subject rather than on any row the owner owns. */
const openRow = (id, over = {}) => ({
  id, owner: 'owner', state: 'open', closedOn: null, what: 'fixture row',
  blocks: 'the first store submission under the fixture name',
  closes: `${SUBJECT} carries trademark.ruling PROCEED or DO-NOT-PROCEED`,
  ...over,
});

/** A live owner row about something else entirely — the review's M1 case. */
const KEY_ESCROW = openRow('O-KEY-ESCROW', {
  what: 'Escrow the upload keys',
  blocks: 'every signed release until the key is escrowed',
  closes: 'the escrow receipt is filed',
});

function setOpen(rows) {
  rmSync(OPEN_JSON, { force: true });
  if (rows !== null) writeJson(OPEN_JSON, { _readme: 'fixture open register', rows });
}

function setQueue(abs, rows) {
  rmSync(abs, { force: true });
  if (rows !== null) writeJson(abs, { _readme: 'fixture owner queue', items: rows });
}

/** The queue every open-id case reads beside open.json: an id is looked up in BOTH
 *  registers, so both must be there. Its rows are about nothing the fixture holds. */
const DEFAULT_QUEUE = [{ id: 'A-1', status: 'pending', what: 'a fixture queue row about nothing held here' }];

/** Run a guard file from the fixture repo. The machine's own root overrides are
 *  removed, or a case would resolve against the REAL corpus and pass over nothing. */
function runGuard({ file = 'assert-public-citations.mjs', args = [], env: extra = {} } = {}) {
  const env = { ...process.env };
  delete env.NIKATRU_PRIVATE_ROOT;
  delete env.NIKATRU_BUSINESS_ROOT;
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  Object.assign(env, extra);
  const r = spawnSync(process.execPath, [join(PUB, 'tooling', 'scripts', file), ...args], { cwd: PUB, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** The mutant: the guard with the `ID CITATIONS BEGIN … END` block deleted, which is
 *  the guard as it stood before this class existed. */
function writeNoClassMutant() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const begin = src.indexOf('/* ── ID CITATIONS BEGIN');
  const end = src.indexOf('ID CITATIONS END', begin);
  assert.notEqual(begin, -1, 'the ID CITATIONS BEGIN marker is gone from the guard, so no mutant can be built and every "the class bites" case would assert nothing');
  assert.notEqual(end, -1, 'the ID CITATIONS END marker is gone from the guard');
  let mutant = src.slice(0, begin) + src.slice(src.indexOf('\n', end) + 1);
  assert.ok(!mutant.includes('resolveHold(h, rowsByClass)'), 'the mutant still resolves holds, so the region deleted was not the one doing the work');
  /* The ROW IDS class (O-PUBLIC-DOCS-HAND-WRITTEN-FACTS) reads every O- id in every
     tracked line, the held one included, so it is deleted too: the mutant is the
     guard as it stood before EITHER class, which is the guard RC1's defect passed. */
  const rowBegin = mutant.indexOf('/* ── ROW IDS BEGIN');
  const rowEnd = mutant.indexOf('ROW IDS END', rowBegin);
  assert.notEqual(rowBegin, -1, 'the ROW IDS BEGIN marker is gone from the guard');
  assert.notEqual(rowEnd, -1, 'the ROW IDS END marker is gone from the guard');
  mutant = mutant.slice(0, rowBegin) + mutant.slice(mutant.indexOf('\n', rowEnd) + 1);
  writeFileSync(join(PUB, 'tooling', 'scripts', 'mutant-no-id-class.mjs'), mutant, 'utf8');
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-owner-ids-'));
  const products = join(BASE, 'Projects');
  PUB = join(products, 'Fixture_Public');
  PRIV = join(products, 'Fixture_Private');
  OPEN_JSON = join(PRIV, 'platform-state', 'open.json');
  QUEUE_JSON = join(BASE, 'nikatru', 'owner-queue.json');

  mkdirSync(join(BASE, 'nikatru'), { recursive: true });
  writeFileSync(join(BASE, 'nikatru', 'README.md'), 'the shared business brain, fixture\n', 'utf8');
  setQueue(QUEUE_JSON, DEFAULT_QUEUE);

  const spec = join(PRIV, 'requirements');
  writeJson(join(spec, 'index.json'), { registers: { 'invariants.json': { kind: 'invariant' } } });
  writeJson(
    join(spec, 'invariants.json'),
    Array.from({ length: ORIGIN_FLOOR + 20 }, (_, i) => ({ id: `INV-${i + 1}`, claim: `fixture claim ${i + 1}`, origin: `[2]C-${i + 1}` })),
  );

  mkdirSync(join(PUB, 'filler'), { recursive: true });
  for (let i = 0; i < FILE_FLOOR + 10; i += 1) writeFileSync(join(PUB, 'filler', `f-${i}.txt`), `filler ${i}\n`, 'utf8');
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

describe('owner-ids.mjs — the grammar and the resolver, as pure functions', () => {
  test('the two namespaces: a word after `O-` is open.json, a number after a dash is the owner queue', () => {
    assert.equal(idClass(ID_SUBLY), 'open');
    assert.equal(idClass('O-SUBMITTERS-COVERAGE-LOST-EXITS-1'), 'open');
    assert.equal(idClass('A-99'), 'queue');
    assert.equal(idClass('O-3'), 'queue', 'the owner queue has carried O-<n> rows since before open.json; `O-` alone is not the test');
    assert.equal(idClass('someone should do it'), null);
    assert.equal(idClass('o-lowercase'), null);
    assert.equal(idClass(42), null);
    assert.equal(isOwnerId(ID_SUBLY), true);
    assert.equal(isOwnerId('K-15 decision'), false);
  });

  test('rows are found wherever the register nests them, and only objects carrying the liveness field count', () => {
    /* Built from parts: a literal fixture id in this tracked file is a citation the
       guard's ROW IDS class would look up in open.json. */
    const NESTED = ['O', 'NESTED', 'ROW'].join('-');
    const MENTIONED = ['O', 'ONLY', 'MENTIONED'].join('-');
    const doc = { _readme: 'x', groups: [{ rows: [openRow(NESTED)] }], mentions: [{ id: MENTIONED }] };
    const { rows, duplicates } = indexRows(doc, 'open');
    assert.ok(rows.has(NESTED));
    assert.equal(rows.has(MENTIONED), false, 'an object with no `state` is a mention, not a row');
    assert.equal(duplicates.size, 0);
    const twice = indexRows({ a: [openRow('O-TWICE')], b: [openRow('O-TWICE', { state: 'done' })] }, 'open');
    assert.ok(twice.duplicates.has('O-TWICE'));
  });

  test('resolveHold: absent, closed, owed by the wrong owner, live, malformed', () => {
    const open = new Map([
      ['O-LIVE', openRow('O-LIVE')],
      ['O-DONE', openRow('O-DONE', { state: 'done' })],
      ['O-AGENTS', openRow('O-AGENTS', { owner: 'agent' })],
    ]);
    const queue = new Map([['A-7', { id: 'A-7', status: 'pending', what: `rule on ${SUBJECT}` }], ['A-8', { id: 'A-8', status: 'done', what: `rule on ${SUBJECT}` }]]);
    const rows = { open, queue };
    const hold = (id, kind = 'owner-ruling') => ({ id, kind, file: SUBJECT, jsonPath: 'trademark.ownerItem' });
    assert.equal(resolveHold(hold('O-LIVE'), rows).verdict, 'live');
    assert.equal(resolveHold(hold('O-MISSING'), rows).verdict, 'absent');
    assert.deepEqual(resolveHold(hold('O-DONE'), rows), { verdict: 'not-live', cls: 'open', state: 'state=done' });
    assert.deepEqual(resolveHold(hold('O-AGENTS'), rows), { verdict: 'not-live', cls: 'open', state: 'owner=agent' });
    assert.equal(resolveHold(hold('O-AGENTS', 'other-kind'), rows).verdict, 'live', 'only an owner-RULING needs the owner to own the row');
    assert.equal(resolveHold(hold('A-7'), rows).verdict, 'live');
    assert.deepEqual(resolveHold(hold('A-8'), rows), { verdict: 'not-live', cls: 'queue', state: 'status=done' });
    assert.equal(resolveHold(hold('nobody'), rows).verdict, 'malformed');
  });

  test('the one subject F1 ships is the clearance record, and a null there holds nothing', () => {
    assert.equal(HOLD_SUBJECTS.length, 1);
    const s = subjectFor('apps/subscriptiontracker/name-clearance.json');
    assert.ok(s);
    assert.equal(s.kind, 'owner-ruling');
    assert.equal(subjectFor('apps/subscriptiontracker/store/name-clearance.json'), null);
    assert.deepEqual(holdsIn(s, SUBJECT, subjectDoc(null)), []);
    assert.deepEqual(holdsIn(s, SUBJECT, subjectDoc('O-X')), [{ file: SUBJECT, jsonPath: 'trademark.ownerItem', id: 'O-X', kind: 'owner-ruling' }]);
  });

  // ⏱ 2026-09-24, the PR 913 review, L3: `holdsIn` read `ownerItem` whatever the
  // ruling, so a recorded ruling that kept its old id for provenance was graded as
  // a hold — while limb 7 of assert-name-clearance.mjs reads the id only while the
  // ruling is null.
  test('a recorded ruling ends the hold; a null or ABSENT ruling leaves it standing', () => {
    const s = subjectFor(SUBJECT);
    assert.deepEqual(holdsIn(s, SUBJECT, subjectDoc(ID_OLD_RULING, { ruling: 'PROCEED' })), [], 'PROCEED kept beside its old id is provenance, not a hold');
    assert.deepEqual(holdsIn(s, SUBJECT, subjectDoc(ID_OLD_RULING, { ruling: 'DO-NOT-PROCEED' })), []);
    assert.equal(holdsIn(s, SUBJECT, subjectDoc(ID_OLD_RULING)).length, 1, 'green control: the same id with a null ruling is a hold');
    const noRuling = subjectDoc(ID_OLD_RULING);
    delete noRuling.trademark.ruling;
    assert.equal(holdsIn(s, SUBJECT, noRuling).length, 1, 'a record that lost its `ruling` field has not recorded one');
  });

  // ⏱ 2026-09-24, the PR 913 review, M1: any live row the owner owned lifted the
  // gate. The review held the record on `O-KEY-ESCROW` and got `live`.
  test('M1 — a live owner row whose text never names the subject is UNRELATED', () => {
    const rows = { open: new Map([['O-KEY-ESCROW', KEY_ESCROW]]), queue: new Map() };
    const hold = { id: 'O-KEY-ESCROW', kind: 'owner-ruling', file: SUBJECT, jsonPath: 'trademark.ownerItem' };
    assert.deepEqual(resolveHold(hold, rows), { verdict: 'unrelated', cls: 'open', id: 'O-KEY-ESCROW', state: 'state=open' });
    const otherApp = { ...hold, file: 'apps/otherapp/name-clearance.json' };
    const named = { open: new Map([['O-NAMED', openRow('O-NAMED')]]), queue: new Map() };
    assert.equal(resolveHold({ ...otherApp, id: 'O-NAMED' }, named).verdict, 'unrelated', 'a row naming ANOTHER app\'s record is not a hold on this one');
  });

  test('M1 — `blocks` alone or `closes` alone names the subject; a queue row is read across its own text fields', () => {
    const hold = (id) => ({ id, kind: 'owner-ruling', file: SUBJECT, jsonPath: 'trademark.ownerItem' });
    const open = new Map([
      [ID_BY_BLOCKS, openRow(ID_BY_BLOCKS, { blocks: `lifting the gate in ${SUBJECT}`, closes: 'a ruling is recorded' })],
      [ID_BY_CLOSES, openRow(ID_BY_CLOSES, { blocks: 'the first submission', closes: `${SUBJECT} carries a ruling` })],
      [ID_BY_WHAT, openRow(ID_BY_WHAT, { what: `rule on ${SUBJECT}`, blocks: 'x', closes: 'y' })],
    ]);
    const queue = new Map([
      ['S-4', { id: 'S-4', status: 'pending', title: 'trademark', notes: [`see ${SUBJECT}`] }],
      ['S-5', { id: 'S-5', status: 'pending', title: 'the trademark ruling for the record' }],
    ]);
    const rows = { open, queue };
    assert.equal(resolveHold(hold(ID_BY_BLOCKS), rows).verdict, 'live');
    assert.equal(resolveHold(hold(ID_BY_CLOSES), rows).verdict, 'live');
    assert.equal(resolveHold(hold(ID_BY_WHAT), rows).verdict, 'unrelated', 'for an open.json row only `blocks` and `closes` are read');
    assert.equal(resolveHold(hold('S-4'), rows).verdict, 'live', 'an array of strings is text');
    assert.equal(resolveHold(hold('S-5'), rows).verdict, 'unrelated');
    assert.equal(subjectText({ id: SUBJECT, status: SUBJECT }, 'queue'), '', 'the id and the liveness field are not the row\'s text');
  });

  // ⏱ 2026-09-24, the PR 913 review, L1: the grammar missed 18 of the queue's 70
  // ids and sent a QUEUE row of open.json's shape to open.json.
  test('L1 — an id is looked up in BOTH registers, whatever its shape', () => {
    const queueDoc = {
      items: [
        { id: 'HOSTINGER-EXPIRY', status: 'pending', what: `renew the host; ${SUBJECT} names it` },
        { id: ID_ADDR, status: 'pending', what: `publish the address; see ${SUBJECT}` },
        { id: 'A-13-orig', status: 'done', what: `renamed; ${SUBJECT}` },
        { id: 'OD-6.1', status: 'pending', what: 'x' },
        { id: ID_BOTH, status: 'pending', what: SUBJECT },
      ],
    };
    const indexed = indexRows(queueDoc, 'queue');
    assert.deepEqual([...indexed.rows.keys()], ['HOSTINGER-EXPIRY', ID_ADDR, 'A-13-orig', 'OD-6.1', ID_BOTH], 'a queue row is keyed on `status`, never on the id grammar');
    const rows = { open: new Map([[ID_BOTH, openRow(ID_BOTH)]]), queue: indexed.rows };
    const hold = (id) => ({ id, kind: 'owner-ruling', file: SUBJECT, jsonPath: 'trademark.ownerItem' });
    assert.equal(idClass('HOSTINGER-EXPIRY'), null, 'the first guess has no answer for it');
    assert.deepEqual(resolveHold(hold('HOSTINGER-EXPIRY'), rows), { verdict: 'live', cls: 'queue', state: 'status=pending' });
    assert.equal(idClass(ID_ADDR), 'open', 'the first guess is wrong for it');
    assert.deepEqual(resolveHold(hold(ID_ADDR), rows), { verdict: 'live', cls: 'queue', state: 'status=pending' });
    assert.deepEqual(resolveHold(hold('A-13-orig'), rows), { verdict: 'not-live', cls: 'queue', state: 'status=done' });
    assert.deepEqual(resolveHold(hold(ID_NOPE), rows), { verdict: 'absent', guess: 'open' });
    assert.deepEqual(resolveHold(hold(ID_BOTH), rows), { verdict: 'ambiguous', classes: ['open', 'queue'] });
    assert.throws(() => resolveHold(hold('A-7'), { open: new Map(), queue: null }), /looked up in both registers/);
  });

  test('L1 — MALFORMED is only a value that cannot be an id: not a string, empty, whitespace, no capital', () => {
    assert.equal(isOwnerId('HOSTINGER-EXPIRY'), true);
    assert.equal(isOwnerId('A-13-orig'), true);
    assert.equal(isOwnerId('OD-6.1'), true);
    assert.equal(isOwnerId(''), false);
    assert.equal(isOwnerId(` ${ID_SUBLY}`), false);
    assert.equal(isOwnerId('O-NAME SUBLY'), false);
    assert.equal(isOwnerId('o-name-subly-trademark'), false);
    assert.equal(isOwnerId(null), false);
    const rows = { open: new Map(), queue: new Map() };
    assert.equal(resolveHold({ id: 7, kind: 'owner-ruling', file: SUBJECT }, rows).verdict, 'malformed');
    assert.equal(resolveHold({ id: 'O-Name-Subly-Trademark', kind: 'owner-ruling', file: SUBJECT }, rows).verdict, 'absent', 'a mixed-case id has an id\'s shape and is looked up; no row carries it');
  });
});

describe('assert-public-citations — the ID CITATIONS class over a fixture workspace', () => {
  test('GREEN CONTROL — a hold on a live owner row resolves, and the ok line counts it', () => {
    setSubject(HELD);
    setOpen([openRow(HELD)]);
    const r = runGuard();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 owner-id hold\(s\) in 1 subject file\(s\)/);
    assert.match(r.out, /1 live/);
  });

  test('RC1 — a held id with NO ROW is exit 1 and names the id; the guard without the class passes it', () => {
    setSubject(ID_SUBLY);
    setOpen([openRow(HELD)]);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(ID_SUBLY));
    assert.match(r.out, /ABSENT/);
    assert.match(r.out, /apps\/fixture\/name-clearance\.json/);

    const old = runGuard({ file: 'mutant-no-id-class.mjs' });
    assert.equal(old.code, 0, `the guard without the ID CITATIONS block must pass this tree, or RC1 is not about the class: ${old.out}`);
  });

  test('RC1 holds with no merge-base too — absence is graded on every run', () => {
    setSubject(ID_SUBLY);
    setOpen([openRow(HELD)]);
    git(PUB, 'update-ref', '-d', 'refs/remotes/origin/main');
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(ID_SUBLY));
  });

  test('RC2 — a CLOSED row, with the subject changed on this branch, is exit 1', () => {
    setSubject(HELD, { changed: true });
    setOpen([openRow(HELD, { state: 'done', closedOn: '2026-09-24' })]);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NOT LIVE \(state=done\)/);
    assert.ok(r.out.includes(HELD), r.out);
  });

  test('RC2b — the same closed row, the subject NOT changed, prints STALE HOLD and exits 0', () => {
    setSubject(HELD);
    setOpen([openRow(HELD, { state: 'done', closedOn: '2026-09-24' })]);
    const r = runGuard();
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.includes(`STALE HOLD ${SUBJECT} trademark.ownerItem ${HELD} state=done`), r.out);
    assert.match(r.out, /1 STALE and printed above/);
  });

  test('RC2c — RC2b under --all-subjects is exit 1', () => {
    setSubject(HELD);
    setOpen([openRow(HELD, { state: 'done', closedOn: '2026-09-24' })]);
    const r = runGuard({ args: ['--all-subjects'] });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NOT LIVE \(state=done\)/);
  });

  test('a closed row with NO merge-base is not graded, and the run says so', () => {
    setSubject(HELD, { changed: true });
    setOpen([openRow(HELD, { state: 'done', closedOn: '2026-09-24' })]);
    git(PUB, 'update-ref', '-d', 'refs/remotes/origin/main');
    const r = runGuard();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /liveness not graded here: no merge-base/);
    assert.ok(r.out.includes(`STALE HOLD ${SUBJECT} trademark.ownerItem ${HELD} state=done`), r.out);
  });

  test('RC3 — an owner ruling carried by an AGENT row, the subject changed, is exit 1', () => {
    setSubject(HELD, { changed: true });
    setOpen([openRow(HELD, { owner: 'agent' })]);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NOT LIVE \(owner=agent\)/);
  });

  test('RC4 — an owner-queue id with the business root ABSENT is exit 2', () => {
    setSubject('A-99');
    setOpen([openRow(HELD)]);
    const r = runGuard({ env: { NIKATRU_BUSINESS_ROOT: join(BASE, 'no-such-business-root') } });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /owner-queue\.json is unreadable/);
    assert.match(r.out, /A-99/);
  });

  test('RC4 control — the same id resolves once the queue is there, at the override and at the default root', () => {
    setSubject('A-99');
    setOpen([openRow(HELD)]);
    const elsewhere = join(BASE, 'elsewhere-business');
    setQueue(join(elsewhere, 'owner-queue.json'), [{ id: 'A-99', status: 'pending', what: `rule on ${SUBJECT}` }]);
    const viaEnv = runGuard({ env: { NIKATRU_BUSINESS_ROOT: elsewhere } });
    assert.equal(viaEnv.code, 0, viaEnv.out);

    setQueue(QUEUE_JSON, [{ id: 'A-99', status: 'done', what: `rule on ${SUBJECT}` }]);
    const viaDefault = runGuard({ args: ['--all-subjects'] });
    assert.equal(viaDefault.code, 1, `the default root is <private root>/../../nikatru, and its A-99 is done: ${viaDefault.out}`);
    assert.match(viaDefault.out, /NOT LIVE \(status=done\)/);
    setQueue(QUEUE_JSON, DEFAULT_QUEUE);
  });

  test('a held open id with open.json unreadable is exit 2; a null hold reads nothing and passes', () => {
    setSubject(HELD);
    setOpen(null);
    const r = runGuard();
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /open\.json is unreadable/);

    setSubject(null);
    const none = runGuard();
    assert.equal(none.code, 0, `a subject holding null must not need open.json: ${none.out}`);
    assert.match(none.out, /0 owner-id hold\(s\) in 1 subject file\(s\)/);
  });

  test('a held value outside the id grammar is exit 1, never skipped', () => {
    setSubject('someone will rule on it');
    setOpen([openRow(HELD)]);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is not an owner id/);
  });

  test('M1 (RC-M1) — a hold on O-KEY-ESCROW, a LIVE owner row about key escrow, is exit 1 UNRELATED', () => {
    setSubject('O-KEY-ESCROW');
    setOpen([openRow(HELD), KEY_ESCROW]);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /holds on O-KEY-ESCROW, a live open\.json row whose text never names apps\/fixture\/name-clearance\.json \(UNRELATED\)/);

    const old = runGuard({ file: 'mutant-no-id-class.mjs' });
    assert.equal(old.code, 0, `the guard without the ID CITATIONS block must pass this tree: ${old.out}`);
  });

  test('M1 control — the same live row, once its `blocks` names the subject file, is a hold and exits 0', () => {
    setSubject('O-KEY-ESCROW');
    setOpen([openRow(HELD), { ...KEY_ESCROW, blocks: `every signed release, and the trademark gate in ${SUBJECT}` }]);
    const r = runGuard();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 live/);
  });

  test('L1 — an owner-QUEUE row of open.json\'s shape resolves from the queue', () => {
    setSubject(ID_ADDR);
    setOpen([openRow(HELD)]);
    setQueue(QUEUE_JSON, [...DEFAULT_QUEUE, { id: ID_ADDR, status: 'pending', what: `publish the address before ${SUBJECT} ships` }]);
    const r = runGuard();
    setQueue(QUEUE_JSON, DEFAULT_QUEUE);
    assert.equal(r.code, 0, `the grammar alone sent this id to open.json, where it is ABSENT: ${r.out}`);
    assert.match(r.out, /1 live/);
  });

  test('L1 — an id BOTH registers carry is exit 1 AMBIGUOUS', () => {
    setSubject(HELD);
    setOpen([openRow(HELD)]);
    setQueue(QUEUE_JSON, [...DEFAULT_QUEUE, { id: HELD, status: 'pending', what: `rule on ${SUBJECT}` }]);
    const r = runGuard();
    setQueue(QUEUE_JSON, DEFAULT_QUEUE);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /open\.json and owner-queue\.json BOTH carry \(AMBIGUOUS\)/);
  });

  test('L3 — a held id with two rows in one register is exit 2', () => {
    setSubject(HELD);
    setOpen([openRow(HELD), openRow(HELD, { state: 'done' })]);
    const r = runGuard();
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, new RegExp(`carries more than one row for ${HELD}`));
  });

  test('L3 — a register with zero readable rows is exit 2, never a report of every id ABSENT', () => {
    setSubject(HELD);
    writeJson(OPEN_JSON, { _readme: 'fixture open register', rows: [] });
    const r = runGuard();
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /not one object in it carries an owner-id-shaped `id` and a `state`/);
  });

  test('L3 — an unparseable subject file is exit 2', () => {
    commitSubject('{ "app": "fixture", "trademark": { "ownerItem": \n', 'an unparseable subject');
    setOpen([openRow(HELD)]);
    const r = runGuard();
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /apps\/fixture\/name-clearance\.json is a hold subject .* and is not parseable JSON/);
  });

  test('L3 — a lower-case variant of a real id is exit 1 MALFORMED', () => {
    setSubject(HELD.toLowerCase());
    setOpen([openRow(HELD)]);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is not an owner id/);
  });

  test('L3 — a mixed-case variant of a real id is exit 1 ABSENT: ids are matched exactly', () => {
    setSubject('O-Fixture-Trademark-Hold');
    setOpen([openRow(HELD)]);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /O-Fixture-Trademark-Hold/);
    assert.match(r.out, /\(ABSENT\)/);
  });

  test('L3 — a real id with a trailing space is exit 1 MALFORMED, never trimmed into a match', () => {
    setSubject(`${HELD} `);
    setOpen([openRow(HELD)]);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is not an owner id/);
  });

  test('L3 — a recorded ruling that keeps its old id holds nothing, and reads no register', () => {
    setSubject(ID_SUBLY, { ruling: 'PROCEED' });
    setOpen(null);
    const r = runGuard();
    setOpen([openRow(HELD)]);
    assert.equal(r.code, 0, `the ruling is recorded, so the id is provenance: ${r.out}`);
    assert.match(r.out, /0 owner-id hold\(s\) in 1 subject file\(s\)/);

    setSubject(ID_SUBLY);
    const owed = runGuard();
    assert.equal(owed.code, 1, `green control: the same id with a null ruling is a hold, and its row is ABSENT: ${owed.out}`);
  });

  test('the fixture guard and resolver are the committed ones, byte for byte', () => {
    assert.equal(readFileSync(join(PUB, 'tooling', 'scripts', 'assert-public-citations.mjs'), 'utf8'), readFileSync(GUARD_SRC, 'utf8'));
    assert.equal(readFileSync(join(PUB, 'tooling', 'scripts', 'owner-ids.mjs'), 'utf8'), readFileSync(OWNER_IDS_SRC, 'utf8'));
    assert.ok(existsSync(join(PUB, 'tooling', 'scripts', 'repo-git.mjs')));
  });
});
