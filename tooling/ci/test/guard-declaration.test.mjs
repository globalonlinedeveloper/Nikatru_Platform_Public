// ─────────────────────────────────────────────────────────────────────────────
// guard-declaration.test.mjs — the loader `spec-guards.mjs` reads the corpus's
// declared guard set through must read the RIGHT blob of the RIGHT repository,
// and must refuse, by limb, everything it cannot act on.
//
// 🔴 WHY IT IS TESTED OVER REAL REPOSITORIES. The declaration is read out of git —
// `HEAD:` for a commit outside the corpus, `:` (the staged index) for a commit in
// it — and git exports `GIT_DIR` into every hook process, which beats `git -C`. A
// loader handed a string would prove the parser and nothing about which bytes it
// was handed. So every case builds a throwaway corpus with `git init`, the same
// two-repository fixture `spec-guards.test.mjs` uses for `repo-git.mjs`, with no
// network and no real corpus. It runs everywhere, CI included.
//
// ── EVERY CASE CARRIES ITS OWN CONTROL ───────────────────────────────────────
// A green over the loader alone would not say the fixture reproduced the
// condition. So each case also shows the condition is live: the working tree it
// must not read really is broken, the staged blob really differs from HEAD, and a
// bare `git -C` under the poisoned environment really answers about the decoy.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  DECLARATION_REL,
  GuardDeclarationError,
  PINNED_HOOK,
  loadGuardDeclaration,
  pinnedGaps,
} from '../../scripts/guard-declaration.mjs';

const git = (where, ...args) => {
  const r = spawnSync('git', ['-C', where, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.status} ${r.stderr}`);
  return r.stdout;
};

const write = (abs, text) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text, 'utf8'); };
const declPath = (root) => join(root, ...DECLARATION_REL.split('/'));

/** A declaration that satisfies the pin: every PINNED_HOOK name on both sides, plus
 *  one entry per side only, so a selection that ignores `hook` is visible. */
function validEntries() {
  return [
    ...PINNED_HOOK.map((id) => ({ id, file: `requirements/tooling/${id}.mjs`, hook: ['public', 'private'], args: [], what: `fixture ${id}` })),
    { id: 'fixture-public-only', file: 'requirements/tooling/fixture-public-only.mjs', hook: ['public'], args: ['--index', '--verbose'], what: 'public only' },
    { id: 'fixture-private-only', file: 'requirements/tooling/fixture-private-only.mjs', hook: ['private'], args: ['--held'], what: 'private only' },
    { id: 'fixture-sweep-only', file: 'requirements/tooling/fixture-sweep-only.mjs', hook: [], args: [], what: 'in no hook' },
  ];
}

/** A committed corpus: `requirements/` present and the declaration at HEAD. */
function corpusRepo(where, doc) {
  mkdirSync(where, { recursive: true });
  git(where, 'init', '-q');
  git(where, 'config', 'user.email', 'fixture@example.test');
  git(where, 'config', 'user.name', 'fixture');
  git(where, 'config', 'commit.gpgsign', 'false');
  write(join(where, 'requirements', 'index.json'), '{}\n');
  if (doc !== undefined) write(declPath(where), typeof doc === 'string' ? doc : `${JSON.stringify(doc, null, 2)}\n`);
  git(where, 'add', '-A');
  git(where, 'commit', '-q', '-m', 'fixture', '--no-gpg-sign');
  return where;
}

/** Run `fn` and return the GuardDeclarationError it throws; fail if it throws
 *  anything else, or nothing. */
function refusalOf(fn) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof GuardDeclarationError, `expected a GuardDeclarationError, got ${e && e.stack}`);
    return e;
  }
  assert.fail('the loader returned where it had to refuse; a refusal that does not happen is the vacuous pass this loader exists to stop');
}

/** Layer `extra` onto process.env for the duration of `fn`, restored on a throw too. */
function withEnv(extra, fn) {
  const saved = new Map();
  for (const [k, v] of Object.entries(extra)) {
    saved.set(k, Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined);
    process.env[k] = v;
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

test('(1) public side: the COMMITTED blob is read, a corrupted working tree is not, and only hook:["public"] entries are selected', () => {
  const base = mkdtempSync(join(tmpdir(), 'guard-decl-public-'));
  try {
    const P = corpusRepo(join(base, 'Fixture_Private'), { entries: validEntries() });
    write(declPath(P), '{ this is not json, and HEAD is clean\n');

    // CONTROL — the working tree really is unreadable, so a loader that read it would refuse.
    assert.throws(() => JSON.parse(readFileSync(declPath(P), 'utf8')), SyntaxError, 'the working-tree corruption did not take, so this case proves nothing about which copy is read');

    const d = loadGuardDeclaration(P, 'public');
    assert.equal(d.blob, `HEAD:${DECLARATION_REL}`);
    const names = d.rows.map((r) => r.name);
    assert.deepEqual(names, [...PINNED_HOOK, 'fixture-public-only'], 'the public side must run exactly the entries whose hook names "public", in declared order');
    assert.equal(names.includes('fixture-private-only'), false, 'a hook:["private"] entry was selected for a Public commit');
    assert.equal(names.includes('fixture-sweep-only'), false, 'an entry in no hook was selected');
    const row = d.rows.find((r) => r.name === 'fixture-public-only');
    assert.deepEqual(row.args, ['--index', '--verbose'], 'args must be the entry\'s own, verbatim and in order');
    assert.deepEqual(row.rel, ['requirements/tooling/fixture-public-only.mjs'], 'rel must be the entry\'s `file`, unprefixed');
    assert.equal(d.entries.length, validEntries().length, 'every declared entry must be parsed, selected or not');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('(2) private side: the STAGED blob is read, not HEAD and not the working tree, and hook:["private"] entries are selected', () => {
  const base = mkdtempSync(join(tmpdir(), 'guard-decl-private-'));
  try {
    const committed = validEntries();
    const P = corpusRepo(join(base, 'Fixture_Private'), { entries: committed });
    const staged = [...validEntries(), { id: 'fixture-staged-only', file: 'requirements/tooling/fixture-staged-only.mjs', hook: ['private'], what: 'staged, not committed' }];
    write(declPath(P), `${JSON.stringify({ entries: staged }, null, 2)}\n`);
    git(P, 'add', DECLARATION_REL);
    write(declPath(P), 'not json: the working tree is neither HEAD nor the index\n');

    // CONTROL — HEAD and the index really differ, so reading HEAD would miss the staged entry.
    const atHead = JSON.parse(git(P, 'show', `HEAD:${DECLARATION_REL}`));
    assert.equal(atHead.entries.some((e) => e.id === 'fixture-staged-only'), false, 'the staged entry is already in HEAD, so this case cannot tell the two blobs apart');

    const d = loadGuardDeclaration(P, 'private');
    assert.equal(d.blob, `:${DECLARATION_REL}`);
    const names = d.rows.map((r) => r.name);
    assert.deepEqual(names, [...PINNED_HOOK, 'fixture-private-only', 'fixture-staged-only'], 'the private side must run the STAGED entries whose hook names "private"');
    assert.equal(names.includes('fixture-public-only'), false, 'a hook:["public"] entry was selected for a commit in the corpus');
    assert.deepEqual(d.rows.find((r) => r.name === 'fixture-staged-only').args, [], 'an entry without `args` runs with none');

    // And the public side of the SAME repository still reads HEAD, where the staged entry is absent.
    assert.equal(loadGuardDeclaration(P, 'public').entries.some((e) => e.id === 'fixture-staged-only'), false, 'the public side read the index; a Public commit must be judged against what the corpus committed');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('(3) a missing blob while the corpus is present is a refusal naming the blob and the root, on both sides', () => {
  const base = mkdtempSync(join(tmpdir(), 'guard-decl-missing-'));
  try {
    const P = corpusRepo(join(base, 'Fixture_Private'));
    // CONTROL — the corpus is present: its marker is committed.
    assert.match(git(P, 'ls-files'), /requirements\/index\.json/);

    const pub = refusalOf(() => loadGuardDeclaration(P, 'public'));
    assert.equal(pub.limb, 'blob');
    assert.match(pub.message, /COMMITTED declaration could not be read/);
    assert.equal(pub.tried.length, 1);
    assert.equal(pub.tried[0].blob, `HEAD:${DECLARATION_REL}`);
    assert.equal(pub.tried[0].root, P);

    // Present in the working tree only: still a refusal. The working tree is never the source.
    write(declPath(P), `${JSON.stringify({ entries: validEntries() })}\n`);
    const priv = refusalOf(() => loadGuardDeclaration(P, 'private'));
    assert.equal(priv.limb, 'blob');
    assert.match(priv.message, /STAGED declaration could not be read/);
    assert.equal(priv.tried[0].blob, `:${DECLARATION_REL}`);

    // A corpus root that is not a repository of its own is the same limb.
    const bare = join(base, 'Not_A_Repo');
    write(declPath(bare), `${JSON.stringify({ entries: validEntries() })}\n`);
    assert.equal(refusalOf(() => loadGuardDeclaration(bare, 'public')).limb, 'blob');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('(4) an unparseable blob, or one with no `entries` list, is a parse refusal — a bare array and `{ guards }` included', () => {
  const base = mkdtempSync(join(tmpdir(), 'guard-decl-parse-'));
  try {
    const notJson = corpusRepo(join(base, 'A_Private'), '{ "entries": [ \n');
    const e1 = refusalOf(() => loadGuardDeclaration(notJson, 'public'));
    assert.equal(e1.limb, 'parse');
    assert.match(e1.message, /is not JSON/);
    assert.equal(e1.tried[0].blob, `HEAD:${DECLARATION_REL}`);

    const noList = corpusRepo(join(base, 'B_Private'), { _readme: 'no entries here', rows: validEntries() });
    const e2 = refusalOf(() => loadGuardDeclaration(noList, 'public'));
    assert.equal(e2.limb, 'parse');
    assert.match(e2.message, /holds no `entries` list/);

    // The declaration's one shape is an object with `entries` (measured 2026-09-24 on the corpus: keys
    // `_what`, `_fields`, `entries`). A shape nobody writes is refused, not accepted as an untested path.
    const bareArray = corpusRepo(join(base, 'C_Private'), validEntries());
    const e3 = refusalOf(() => loadGuardDeclaration(bareArray, 'public'));
    assert.equal(e3.limb, 'parse');
    assert.match(e3.message, /holds no `entries` list/);

    const guardsKey = corpusRepo(join(base, 'D_Private'), { guards: validEntries() });
    const e4 = refusalOf(() => loadGuardDeclaration(guardsKey, 'private'));
    assert.equal(e4.limb, 'parse');
    assert.match(e4.message, /holds no `entries` list/);

    // CONTROL — the same entries under `entries`, beside the corpus's two other top-level keys, load.
    const real = { _what: 'fixture', _fields: {}, entries: validEntries() };
    assert.equal(loadGuardDeclaration(corpusRepo(join(base, 'E_Private'), real), 'public').entries.length, validEntries().length);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('(5) an entry without id, file or hook is refused, and every malformed entry is named', () => {
  const base = mkdtempSync(join(tmpdir(), 'guard-decl-entry-'));
  try {
    const entries = validEntries();
    delete entries[16].id;                       // fixture-public-only loses its id
    delete entries[17].file;                     // fixture-private-only loses its file
    delete entries[18].hook;                     // fixture-sweep-only loses its hook
    const P = corpusRepo(join(base, 'Fixture_Private'), { entries });
    const e = refusalOf(() => loadGuardDeclaration(P, 'public'));
    assert.equal(e.limb, 'entry');
    assert.equal(e.detail.length, 3, `all three malformed entries must be named, not the first: ${e.detail.join(' | ')}`);
    assert.ok(e.detail.some((l) => /^entry 16: no `id`/.test(l)), e.detail.join(' | '));
    assert.ok(e.detail.some((l) => /^entry 17 \(fixture-private-only\): no `file`/.test(l)), e.detail.join(' | '));
    assert.ok(e.detail.some((l) => /^entry 18 \(fixture-sweep-only\): no `hook`/.test(l)), e.detail.join(' | '));

    // A hook that is not a list, and args that are not a list, are the same limb:
    // spreading a string into argv would run the guard with one argument per character.
    const shapes = validEntries();
    shapes[16].hook = 'public';
    shapes[17].args = '--held';
    const Q = corpusRepo(join(base, 'Shapes_Private'), { entries: shapes });
    const f = refusalOf(() => loadGuardDeclaration(Q, 'public'));
    assert.equal(f.limb, 'entry');
    assert.deepEqual(f.detail, ['entry 16 (fixture-public-only): `hook` is not a list of strings', 'entry 17 (fixture-private-only): `args` is not a list of strings']);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('(6) a pinned guard absent, or declared for one side only, is refused — assert-platform-state removed is COVERAGE LOST', () => {
  const base = mkdtempSync(join(tmpdir(), 'guard-decl-pinned-'));
  try {
    const without = validEntries().filter((e) => e.id !== 'assert-platform-state');
    const P = corpusRepo(join(base, 'Fixture_Private'), { entries: without });
    for (const side of ['public', 'private']) {
      const e = refusalOf(() => loadGuardDeclaration(P, side));
      assert.equal(e.limb, 'pinned');
      assert.deepEqual(e.detail, ['assert-platform-state: not declared'], `side ${side}: ${e.detail.join(' | ')}`);
    }

    const oneSided = validEntries();
    oneSided.find((e) => e.id === 'gen-traps').hook = ['private'];
    const Q = corpusRepo(join(base, 'OneSided_Private'), { entries: oneSided });
    const g = refusalOf(() => loadGuardDeclaration(Q, 'private'));
    assert.equal(g.limb, 'pinned');
    assert.deepEqual(g.detail, ['gen-traps: declared with hook ["private"], which lacks "public"']);

    // CONTROL — the pin itself: sixteen names, and a pin list without the name stops seeing the gap.
    assert.equal(PINNED_HOOK.length, 16, 'the pin is not the sixteen names the hook must run on both sides');
    assert.deepEqual(pinnedGaps(without), ['assert-platform-state: not declared']);
    assert.deepEqual(pinnedGaps(without, PINNED_HOOK.filter((n) => n !== 'assert-platform-state')), [], 'the gap is not attributable to the pin list');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('(7) an exported GIT_DIR and GIT_INDEX_FILE naming another repository do not redirect the read', () => {
  const base = mkdtempSync(join(tmpdir(), 'guard-decl-gitdir-'));
  try {
    const P = corpusRepo(join(base, 'Fixture_Private'), { entries: validEntries() });
    // The decoy: a repository whose committed declaration lacks a pinned guard, so
    // reading it instead of P is a refusal rather than a quiet wrong answer.
    const D = corpusRepo(join(base, 'Decoy_Public'), { entries: validEntries().filter((e) => e.id !== 'check-dod-sync') });
    const poison = { GIT_DIR: join(D, '.git'), GIT_INDEX_FILE: join(D, '.git', 'index') };

    withEnv(poison, () => {
      assert.equal(loadGuardDeclaration(P, 'public').rows.some((r) => r.name === 'check-dod-sync'), true, 'the loader read the decoy named by GIT_DIR');
      assert.equal(loadGuardDeclaration(P, 'private').rows.some((r) => r.name === 'check-dod-sync'), true, 'the loader read the index named by GIT_INDEX_FILE');

      // CONTROL — the same read WITHOUT repo-git.mjs answers about the decoy.
      const raw = spawnSync('git', ['-C', P, 'cat-file', 'blob', `HEAD:${DECLARATION_REL}`], { encoding: 'utf8' });
      assert.equal(raw.status, 0, `the unguarded control failed to run: ${raw.stderr}`);
      assert.equal(JSON.parse(raw.stdout).entries.some((e) => e.id === 'check-dod-sync'), false, 'the unguarded `git -C` did NOT read the decoy, so this environment does not reproduce the hook and the assertions above prove nothing');
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('(8) a hook value that is neither "public" nor "private" is an entry refusal naming the value', () => {
  const base = mkdtempSync(join(tmpdir(), 'guard-decl-hookvalue-'));
  try {
    // A misspelt side would put the entry in no hook while the declaration reads as if it
    // were in one; a third side name would be a hook nobody runs.
    const entries = validEntries();
    entries[16].hook = ['public', 'pre-push'];
    entries[17].hook = ['Private'];
    const P = corpusRepo(join(base, 'Fixture_Private'), { entries });
    for (const side of ['public', 'private']) {
      const e = refusalOf(() => loadGuardDeclaration(P, side));
      assert.equal(e.limb, 'entry');
      assert.deepEqual(e.detail, [
        'entry 16 (fixture-public-only): `hook` names "pre-push", which is neither "public" nor "private"',
        'entry 17 (fixture-private-only): `hook` names "Private", which is neither "public" nor "private"',
      ], `side ${side}: ${e.detail.join(' | ')}`);
    }

    // CONTROL — an empty hook (a sweep-only entry) is not a hook value and still loads.
    const sweep = validEntries();
    assert.deepEqual(sweep[18].hook, []);
    assert.equal(loadGuardDeclaration(corpusRepo(join(base, 'Sweep_Private'), { entries: sweep }), 'public').entries.length, sweep.length);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
