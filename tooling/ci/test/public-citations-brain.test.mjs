// ─────────────────────────────────────────────────────────────────────────────
// public-citations-brain.test.mjs — the BRAIN PATHS class of
// tooling/scripts/assert-public-citations.mjs (rv2-business 008).
//
// A public file citing the shared business brain must name a file that exists, a
// `§<n>` or `#<anchor>` must name one of its headings, and a line cite into a
// brain `.md` is refused outright. The brief's red control is case 2: the old
// decisions-log line cite, restored, exits 1 — and the guard with the class
// deleted passes the same bytes, which is what proves the class is what bites.
//
// The fixture workspace mirrors public-citations-ids.test.mjs (a public repo over
// the guard's file floor, a private corpus over its origin floor) plus a brain.
//
// ⚠️ EVERY BRAIN PREFIX HERE IS COMPOSED, never written whole: this file is tracked,
// the real guard scans it, and a literal citation would be resolved against the
// REAL brain on every hook run.
//
// Run:  node --test tooling/ci/test/public-citations-brain.test.mjs
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

const readConst = (name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(readFileSync(GUARD_SRC, 'utf8'));
  assert.ok(m, `assert-public-citations.mjs no longer declares \`const ${name} = <n>;\``);
  return Number(m[1]);
};
const ORIGIN_FLOOR = readConst('ORIGIN_FLOOR');
const FILE_FLOOR = readConst('FILE_FLOOR');

const NK = ['nikatru', ''].join('/');
const LOG = `${NK}decisions/decisions-log.md`;
const APPLE = `${NK}vendors/apple.md`;
const DOC = 'docs/brain.md';

let BASE, PUB, BRAIN;

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
};
const writeJson = (abs, value) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`); };
const writeText = (abs, text) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); };
const setDoc = (text) => writeFileSync(join(PUB, DOC), text, 'utf8');

function runGuard(file = 'assert-public-citations.mjs') {
  const env = { ...process.env };
  delete env.NIKATRU_PRIVATE_ROOT;
  delete env.NIKATRU_BUSINESS_ROOT;
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const r = spawnSync(process.execPath, [join(PUB, 'tooling', 'scripts', file)], { cwd: PUB, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** The guard with the BRAIN PATHS region deleted: the guard before the class existed. */
function writeNoClassMutant() {
  const src = readFileSync(GUARD_SRC, 'utf8');
  const begin = src.indexOf('/* ── BRAIN PATHS BEGIN');
  const end = src.indexOf('BRAIN PATHS END', begin);
  assert.notEqual(begin, -1, 'the BRAIN PATHS BEGIN marker is gone, so no mutant can be built');
  assert.notEqual(end, -1, 'the BRAIN PATHS END marker is gone');
  const mutant = src.slice(0, begin) + src.slice(src.indexOf('\n', end) + 1);
  assert.ok(!mutant.includes('matchAll(RE_BRAIN_PATH)'), 'the mutant still resolves brain paths, so the region deleted was not the one doing the work');
  writeFileSync(join(PUB, 'tooling', 'scripts', 'mutant-no-brain-paths.mjs'), mutant, 'utf8');
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-brain-paths-'));
  PUB = join(BASE, 'Projects', 'Fixture_Public');
  const PRIV = join(BASE, 'Projects', 'Fixture_Private');
  BRAIN = join(BASE, 'nikatru');

  writeText(join(BRAIN, 'README.md'), '# the shared business brain, fixture\n');
  writeText(join(BRAIN, 'decisions', 'decisions-log.md'), '# Decisions log\n\n## 2026-07-21\n\n- a fixture decision\n');
  writeText(join(BRAIN, 'vendors', 'apple.md'), '# Apple\n\n## Status\n\nfixture\n\n## 9. Fixture section\n\nfixture\n');

  const spec = join(PRIV, 'requirements');
  writeJson(join(spec, 'index.json'), { registers: { 'invariants.json': { kind: 'invariant' } } });
  writeJson(join(spec, 'invariants.json'), Array.from({ length: ORIGIN_FLOOR + 20 }, (_, i) => ({ id: `INV-${i + 1}`, claim: `fixture claim ${i + 1}`, origin: `[2]C-${i + 1}` })));
  writeJson(join(PRIV, 'platform-state', 'open.json'), { _readme: 'fixture', rows: [] });
  writeJson(join(PRIV, 'platform-state', 'programme.json'), { _readme: 'fixture', phases: [] });

  mkdirSync(join(PUB, 'filler'), { recursive: true });
  for (let i = 0; i < FILE_FLOOR + 10; i += 1) writeFileSync(join(PUB, 'filler', `f-${i}.txt`), `filler ${i}\n`, 'utf8');
  mkdirSync(join(PUB, 'docs'), { recursive: true });
  setDoc('# brain\n\nNothing cited yet.\n');
  git(PUB, 'init', '-q');
  git(PUB, 'config', 'user.email', 'fixture@example.test');
  git(PUB, 'config', 'user.name', 'fixture');
  git(PUB, 'config', 'commit.gpgsign', 'false');
  git(PUB, 'add', '-A');
  git(PUB, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');

  mkdirSync(join(PUB, 'tooling', 'scripts'), { recursive: true });
  cpSync(GUARD_SRC, join(PUB, 'tooling', 'scripts', 'assert-public-citations.mjs'));
  cpSync(GIT_HELPER_SRC, join(PUB, 'tooling', 'scripts', 'repo-git.mjs'));
  cpSync(OWNER_IDS_SRC, join(PUB, 'tooling', 'scripts', 'owner-ids.mjs'));
  writeNoClassMutant();
});

after(() => rmSync(BASE, { recursive: true, force: true }));

describe('the BRAIN PATHS class, over a fixture workspace', () => {
  test('green control: a heading anchor and a § that resolve pass, and the run counts them', () => {
    setDoc(`# brain\n\nLocked at \`${LOG}#2026-07-21\`; recorded in ${APPLE} §9.\n`);
    const r = runGuard();
    assert.equal(r.code, 0, `green control first: ${r.out}`);
    assert.match(r.out, /2 brain citation\(s\) resolved against/);
  });

  test('RED CONTROL: the old decisions-log LINE cite, restored, exits 1 — and the guard without the class passes it', () => {
    setDoc(`# brain\n\n\`${LOG}:82\` still locks the web stack.\n`);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /:3 {2}a line cite into a brain \.md — cite its heading/);
    const old = runGuard('mutant-no-brain-paths.mjs');
    assert.equal(old.code, 0, `without the class the same tree passed — that is the defect: ${old.out}`);
  });

  test('a "line NN" cite is refused the same way', () => {
    setDoc(`# brain\n\nSee ${APPLE}, line 12.\n`);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a line cite into a brain \.md/);
  });

  test('a brain file that does not exist exits 1', () => {
    setDoc(`# brain\n\nSee ${NK}vendors/nosuch.md.\n`);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no such brain path/);
  });

  test('a § that names no heading exits 1, and so does an anchor', () => {
    setDoc(`# brain\n\nSee ${APPLE} §7 and ${LOG}#2026-07-22.\n`);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /§7 {2}|no such heading/);
    assert.equal((r.out.match(/no such heading in the brain file/g) ?? []).length, 2, r.out);
  });

  test('the backticked form after the word "brain" is a citation too', () => {
    const p = ['vendors', 'nosuch.md'].join('/');
    setDoc(`# brain\n\nRecorded in the brain's \`${p}\`.\n`);
    const r = runGuard();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no such brain path/);
  });

  test('a disclosed absence passes, by the guard\'s convention', () => {
    setDoc(`# brain\n\nSee ${NK}vendors/nosuch.md (deleted 2026-01-01).\n`);
    assert.equal(runGuard().code, 0);
  });

  test('a public site path or a package scope is not a brain citation', () => {
    setDoc(`# brain\n\nsites/${NK}README.md and @${NK}tokens are ours.\n`);
    const r = runGuard();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0 brain citation\(s\)/);
  });

  test('a brain directory that holds neither README.md nor AGENTS.md is refused, exit 2', () => {
    rmSync(join(BRAIN, 'README.md'));
    try {
      const r = runGuard();
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /holds neither README\.md nor AGENTS\.md/);
    } finally {
      writeText(join(BRAIN, 'README.md'), '# the shared business brain, fixture\n');
    }
  });
});
