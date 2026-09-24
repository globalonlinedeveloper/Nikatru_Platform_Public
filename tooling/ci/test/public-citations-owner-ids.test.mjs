// ─────────────────────────────────────────────────────────────────────────────
// public-citations-owner-ids.test.mjs — the ID CITATIONS class of
// assert-public-citations.mjs, and the resolver it imports from
// tooling/scripts/owner-ids.mjs.
//
// 🔴 THE DEFECT, MEASURED BEFORE THIS FILE EXISTED (apps-review F1). The clearance
// record held its trademark block on `O-NAME-SUBLY-TRADEMARK`, a row that was never
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

import { idClass, isOwnerId, indexRows, resolveHold, holdsIn, subjectFor, HOLD_SUBJECTS } from '../../scripts/owner-ids.mjs';

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
const HELD = 'O-FIXTURE-TRADEMARK-HOLD';

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
 *  byte the class does not read, so "the subject changed" never means "the id changed". */
const subjectDoc = (ownerItem, { edited = false } = {}) => ({
  app: 'fixture',
  trademark: {
    signals: edited ? ['fixture signal, edited on this branch'] : [],
    ruling: null,
    ruledBy: null,
    ruledOn: null,
    ownerItem,
    gatedUntil: ownerItem === null ? null : '2099-01-01',
  },
});

/** Commit the subject holding `ownerItem` and point `origin/main` at that commit, so
 *  the subject is identical to the merge-base. `changed` then edits the working tree,
 *  which is what a branch in a pre-commit hook looks like. */
function setSubject(ownerItem, { changed = false } = {}) {
  writeJson(join(PUB, SUBJECT), subjectDoc(ownerItem));
  git(PUB, 'add', '--', SUBJECT);
  git(PUB, 'commit', '-q', '--allow-empty', '-m', `hold ${ownerItem}`, '--no-gpg-sign');
  git(PUB, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (changed) writeJson(join(PUB, SUBJECT), subjectDoc(ownerItem, { edited: true }));
}

const openRow = (id, over = {}) => ({ id, owner: 'owner', state: 'open', closedOn: null, what: 'fixture row', ...over });

function setOpen(rows) {
  rmSync(OPEN_JSON, { force: true });
  if (rows !== null) writeJson(OPEN_JSON, { _readme: 'fixture open register', rows });
}

function setQueue(abs, rows) {
  rmSync(abs, { force: true });
  if (rows !== null) writeJson(abs, { _readme: 'fixture owner queue', items: rows });
}

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
  const mutant = src.slice(0, begin) + src.slice(src.indexOf('\n', end) + 1);
  assert.ok(!mutant.includes('resolveHold(h, rowsByClass)'), 'the mutant still resolves holds, so the region deleted was not the one doing the work');
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
    assert.equal(idClass('O-NAME-SUBLY-TRADEMARK'), 'open');
    assert.equal(idClass('O-SUBMITTERS-COVERAGE-LOST-EXITS-1'), 'open');
    assert.equal(idClass('A-99'), 'queue');
    assert.equal(idClass('O-3'), 'queue', 'the owner queue has carried O-<n> rows since before open.json; `O-` alone is not the test');
    assert.equal(idClass('someone should do it'), null);
    assert.equal(idClass('o-lowercase'), null);
    assert.equal(idClass(42), null);
    assert.equal(isOwnerId('O-NAME-SUBLY-TRADEMARK'), true);
    assert.equal(isOwnerId('K-15 decision'), false);
  });

  test('rows are found wherever the register nests them, and only objects carrying the liveness field count', () => {
    const doc = { _readme: 'x', groups: [{ rows: [openRow('O-NESTED-ROW')] }], mentions: [{ id: 'O-ONLY-MENTIONED' }] };
    const { rows, duplicates } = indexRows(doc, 'open');
    assert.ok(rows.has('O-NESTED-ROW'));
    assert.equal(rows.has('O-ONLY-MENTIONED'), false, 'an object with no `state` is a mention, not a row');
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
    const queue = new Map([['A-7', { id: 'A-7', status: 'pending' }], ['A-8', { id: 'A-8', status: 'done' }]]);
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
    setSubject('O-NAME-SUBLY-TRADEMARK');
    setOpen([openRow(HELD)]);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /O-NAME-SUBLY-TRADEMARK/);
    assert.match(r.out, /ABSENT/);
    assert.match(r.out, /apps\/fixture\/name-clearance\.json/);

    const old = runGuard({ file: 'mutant-no-id-class.mjs' });
    assert.equal(old.code, 0, `the guard without the ID CITATIONS block must pass this tree, or RC1 is not about the class: ${old.out}`);
  });

  test('RC1 holds with no merge-base too — absence is graded on every run', () => {
    setSubject('O-NAME-SUBLY-TRADEMARK');
    setOpen([openRow(HELD)]);
    git(PUB, 'update-ref', '-d', 'refs/remotes/origin/main');
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /O-NAME-SUBLY-TRADEMARK/);
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
    setOpen(null);
    const r = runGuard({ env: { NIKATRU_BUSINESS_ROOT: join(BASE, 'no-such-business-root') } });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /owner-queue\.json is unreadable/);
    assert.match(r.out, /A-99/);
  });

  test('RC4 control — the same id resolves once the queue is there, at the override and at the default root', () => {
    setSubject('A-99');
    setOpen(null);
    const elsewhere = join(BASE, 'elsewhere-business');
    setQueue(join(elsewhere, 'owner-queue.json'), [{ id: 'A-99', status: 'pending', what: 'fixture' }]);
    const viaEnv = runGuard({ env: { NIKATRU_BUSINESS_ROOT: elsewhere } });
    assert.equal(viaEnv.code, 0, viaEnv.out);

    setQueue(QUEUE_JSON, [{ id: 'A-99', status: 'done', what: 'fixture' }]);
    const viaDefault = runGuard({ args: ['--all-subjects'] });
    assert.equal(viaDefault.code, 1, `the default root is <private root>/../../nikatru, and its A-99 is done: ${viaDefault.out}`);
    assert.match(viaDefault.out, /NOT LIVE \(status=done\)/);
    setQueue(QUEUE_JSON, null);
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

  test('the fixture guard and resolver are the committed ones, byte for byte', () => {
    assert.equal(readFileSync(join(PUB, 'tooling', 'scripts', 'assert-public-citations.mjs'), 'utf8'), readFileSync(GUARD_SRC, 'utf8'));
    assert.equal(readFileSync(join(PUB, 'tooling', 'scripts', 'owner-ids.mjs'), 'utf8'), readFileSync(OWNER_IDS_SRC, 'utf8'));
    assert.ok(existsSync(join(PUB, 'tooling', 'scripts', 'repo-git.mjs')));
  });
});
