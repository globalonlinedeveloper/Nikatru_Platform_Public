// ─────────────────────────────────────────────────────────────────────────────
// retention-coverage.test.mjs — assert-retention-coverage.mjs must be able to FAIL.
//
// [pipeline O-17] Every store the portfolio holds carries a declared retention
// rule — not "every store WITH a rule", which is what the drafted acceptance
// said and which EXCLUDED THE ONE STORE IT WAS WRITTEN ABOUT.
//
// 🔴 THIS GUARD'S FIRST RUN AFTER A REBASE IS ITS OWN BEST EVIDENCE, AND IT IS
// NOT A FIXTURE. `main` grew five tables while this branch sat unmerged — the
// money rail's provider_notifications, provider_accounts, unclaimed_payments and
// revocation_reasons, plus cancellation_requests. On the first run against the
// rebased tree the guard went RED and named all five, before any human noticed
// the register had aged. That is the enumeration limb doing the entire job it
// exists for: a hand-written register drifts from the tree in ONE DIRECTION —
// the tree grows — and the drift is invisible from inside the register.
//
// ⚠️ REAL-TREE MUTATIONS, RE-RUN FROM SCRATCH ON 2026-08-02 against a COPY of
// this worktree. The claim previously in this header was inherited from an agent
// that died before verifying anything, so none of it was trusted. Six for this
// guard, each: baseline green -> mutate -> exit 1 with the intended message ->
// restore FROM MEMORY -> byte-compare -> re-verify green. A crash is not a catch.
//
//   R1 a KV binding deleted from a live wrangler config -> COVERAGE LOST (the rule's
//                                                          store is gone — the domain
//                                                          must not shrink quietly)
//   R2 a new CREATE TABLE added to a live migration     -> "has NO retention row"
//   R3 the rule for an enumerated store removed         -> "has NO retention row"
//   R4 `expirationTtl` renamed in subscribe.js          -> "contains no `expirationTtl`"
//   R5 every retention row removed                      -> COVERAGE LOST
//   R6 a rule whose store is gone                       -> "the domain SHRINKING is a failure"
//   6/6 caught, none crashed, every restore byte-identical and green again.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { tablesIn, enumerateStores, parseJsonc } from '../assert-retention-coverage.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-retention-coverage.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ret-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const WRANGLER = JSON.stringify({
  name: 'svc',
  d1_databases: [{ binding: 'DB', database_name: 'demo_db', migrations_dir: 'migrations' }],
  kv_namespaces: [{ binding: 'CACHE', id: 'x' }],
});

const MIGRATION = `-- a header that mentions CREATE TABLE ghost_table on purpose
CREATE TABLE IF NOT EXISTS real_table (a TEXT);
`;

function register(rows, requiredIds = []) {
  return JSON.stringify({
    _kinds: ['retention'],
    _providers: ['cloudflare'],
    _maxCadenceDays: { retention: 365 },
    _requiredCoverage: { ids: requiredIds },
    rows,
  });
}

function retentionRow(store, extra = {}) {
  return {
    id: `retention.${store}`,
    kind: 'retention',
    store,
    what: 'a store',
    detector: 'this guard',
    response: 'n/a',
    cadence: '365d',
    rule: 'keep',
    keepWhy: 'it is the record',
    mechanism: { substrate: 'cloudflare-d1', anchor: 'services/svc/wrangler.jsonc', record: 'the store', failingValue: 'n/a', readBy: 'this guard' },
    accessProviders: ['cloudflare'],
    source: 'verified',
    ...extra,
  };
}

/** A fixture repo that PASSES, so every mutation is proven to fail for its own
 *  reason and not for one the fixture already had. */
function makeRepo(mutate = () => {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'services/svc/migrations'), { recursive: true });
  mkdirSync(join(root, 'tooling/ops'), { recursive: true });
  writeFileSync(join(root, 'services/svc/wrangler.jsonc'), WRANGLER);
  writeFileSync(join(root, 'services/svc/migrations/0001_init.sql'), MIGRATION);
  // The external row is part of the BASELINE, not an optional extra: a domain
  // with no external half is itself a refusal (see the COVERAGE LOST test
  // below), so a fixture without one could never be green.
  const state = {
    rows: [
      retentionRow('d1:demo_db:real_table'),
      retentionRow('kv:svc:CACHE'),
      { ...retentionRow('kv:external:thing'), id: 'retention.kv.external' },
    ],
    requiredIds: ['retention.kv.external'],
  };
  mutate(state, root);
  writeFileSync(join(root, 'tooling/ops/register.json'), register(state.rows, state.requiredIds));
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

describe('assert-retention-coverage — the fixture repo must be green first', () => {
  test('a repo whose every enumerated store has a rule passes', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /every enumerated store carries a declared retention rule/);
  });
});

describe('assert-retention-coverage — the domain is ENUMERATED, so a store cannot leave it', () => {
  test('a table with no rule FAILS — the defect the requirement was written about', () => {
    const root = makeRepo((s) => { s.rows = s.rows.filter((x) => !x.store.startsWith('d1:')); });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /`d1:demo_db:real_table`.*has NO retention row/s);
  });

  test('a KV binding with no rule FAILS', () => {
    const root = makeRepo((s) => { s.rows = s.rows.filter((x) => !x.store.startsWith('kv:')); });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /`kv:svc:CACHE`/);
  });

  test('a rule whose store no longer exists is COVERAGE LOST, not a harmless stale line', () => {
    const root = makeRepo((s) => { s.rows.push(retentionRow('kv:svc:DELETED')); });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /the domain SHRINKING is a failure here/);
  });

  test('two rules for the same store FAIL — one of them is never read', () => {
    const root = makeRepo((s) => { s.rows.push({ ...retentionRow('kv:svc:CACHE'), id: 'retention.dupe' }); });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /two retention rows claim the same store/);
  });

  test('no retention rows at all is COVERAGE LOST, never "perfect coverage of nothing"', () => {
    const root = makeRepo((s) => { s.rows = []; });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('no wrangler config at all is COVERAGE LOST', () => {
    const root = join(TMP, `n${seq++}`);
    mkdirSync(join(root, 'tooling/ops'), { recursive: true });
    writeFileSync(join(root, 'tooling/ops/register.json'), register([retentionRow('kv:a:B')], []));
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /no live wrangler config found/);
  });

  test('a missing migrations directory is COVERAGE LOST — every table would leave the domain', () => {
    const root = makeRepo();
    rmSync(join(root, 'services/svc/migrations'), { recursive: true, force: true });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /that directory does not exist/);
  });

  test('a migrations directory with no .sql is COVERAGE LOST', () => {
    const root = makeRepo();
    rmSync(join(root, 'services/svc/migrations/0001_init.sql'));
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /contains no .sql file/);
  });
});

describe('assert-retention-coverage — the EXTERNAL half no tree walk can reach', () => {
  test('a required external id with no row FAILS', () => {
    const root = makeRepo((s) => { s.rows = s.rows.filter((x) => x.id !== 'retention.kv.external'); });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /_requiredCoverage names `retention.kv.external`/);
  });

  test('an external row is allowed to name a store the tree does NOT contain', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\+ 1 external/);
  });

  test('an id list with no retention entries at all is COVERAGE LOST', () => {
    // The real register always carries some; emptying the list proves the guard
    // refuses rather than treating "no external stores" as a fact about the world.
    const root = makeRepo((s) => {
      s.requiredIds = [];
      s.rows = s.rows.filter((x) => x.id !== 'retention.kv.external');
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /names no `retention\.\*` id/);
  });
});

describe('assert-retention-coverage — a `ttl` rule is read from the CODE, not believed', () => {
  test('a ttl rule whose anchor has no expirationTtl FAILS', () => {
    const root = makeRepo((s, r) => {
      mkdirSync(join(r, 'functions'), { recursive: true });
      writeFileSync(join(r, 'functions/sub.js'), 'await env.KV.put(key, value);\n');
      s.requiredIds = ['retention.kv.external'];
      s.rows.push({
        ...retentionRow('kv:external:rl'),
        id: 'retention.kv.external',
        rule: 'ttl',
        keepWhy: undefined,
        mechanism: { substrate: 'cloudflare-kv', anchor: 'functions/sub.js', record: 'the ttl', failingValue: 'a put without one', readBy: 'this guard' },
      });
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /contains no `expirationTtl`/);
  });

  test('a ttl rule whose anchor DOES carry expirationTtl passes', () => {
    const root = makeRepo((s, r) => {
      mkdirSync(join(r, 'functions'), { recursive: true });
      writeFileSync(join(r, 'functions/sub.js'), 'await env.KV.put(key, value, { expirationTtl: 600 });\n');
      s.requiredIds = ['retention.kv.external'];
      s.rows.push({
        ...retentionRow('kv:external:rl'),
        id: 'retention.kv.external',
        rule: 'ttl',
        keepWhy: undefined,
        mechanism: { substrate: 'cloudflare-kv', anchor: 'functions/sub.js', record: 'the ttl', failingValue: 'a put without one', readBy: 'this guard' },
      });
    });
    const r = run(root);
    assert.equal(r.code, 0, r.out);
  });

  test('a ttl rule anchored at a file that does not exist FAILS rather than passing unchecked', () => {
    const root = makeRepo((s) => {
      s.requiredIds = ['retention.kv.external'];
      s.rows.push({
        ...retentionRow('kv:external:rl'),
        id: 'retention.kv.external',
        rule: 'ttl',
        keepWhy: undefined,
        mechanism: { substrate: 'cloudflare-kv', anchor: 'functions/gone.js', record: 'the ttl', failingValue: 'x', readBy: 'y' },
      });
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /does not exist, so the claim cannot be checked/);
  });
});

describe('assert-retention-coverage — the SQL scan does not read comments or string literals', () => {
  test('a CREATE TABLE inside a -- comment is NOT a store', () => {
    assert.deepEqual(tablesIn('-- CREATE TABLE ghost (a TEXT);\nCREATE TABLE real (b TEXT);'), ['real']);
  });

  test('a CREATE TABLE inside a block comment is NOT a store', () => {
    assert.deepEqual(tablesIn('/* CREATE TABLE ghost (a TEXT); */ CREATE TABLE real (b TEXT);'), ['real']);
  });

  test('a CREATE TABLE inside a string literal is NOT a store', () => {
    assert.deepEqual(tablesIn("INSERT INTO log VALUES ('CREATE TABLE ghost (a)'); CREATE TABLE real (b);"), ['real']);
  });

  test('IF NOT EXISTS and quoting variants are all recognised', () => {
    assert.deepEqual(tablesIn('CREATE TABLE IF NOT EXISTS a (x);\ncreate table "b" (y);\nCREATE TABLE `c` (z);'), ['a', 'b', 'c']);
  });
});

describe('assert-retention-coverage — enumeration details that decide the domain', () => {
  test('a D1 binding WITHOUT migrations_dir contributes no duplicate tables', () => {
    const root = join(TMP, `d${seq++}`);
    mkdirSync(join(root, 'services/a/migrations'), { recursive: true });
    mkdirSync(join(root, 'services/b'), { recursive: true });
    writeFileSync(join(root, 'services/a/migrations/0001.sql'), 'CREATE TABLE t (x);');
    writeFileSync(
      join(root, 'services/a/wrangler.jsonc'),
      JSON.stringify({ name: 'a', d1_databases: [{ binding: 'DB', database_name: 'shared', migrations_dir: 'migrations' }] }),
    );
    writeFileSync(
      join(root, 'services/b/wrangler.jsonc'),
      JSON.stringify({ name: 'b', d1_databases: [{ binding: 'DB', database_name: 'shared' }] }),
    );
    const { stores } = enumerateStores(root);
    assert.deepEqual([...stores.keys()], ['d1:shared:t']);
  });

  test('parseJsonc survives the comment style every wrangler config here uses', () => {
    assert.equal(parseJsonc('{\n  // c\n  "a": "http://x/y",\n}').a, 'http://x/y');
  });
});

describe('assert-retention-coverage — end to end, against the real repository', () => {
  test('the committed register covers every store the real tree enumerates', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  });

  test('and it PRINTS the undeclared-period gap rather than filling it in', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.match(r.stdout, /PERIOD UNDECLARED/);
  });
});
