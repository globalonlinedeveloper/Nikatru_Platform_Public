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
// ⚠️ FOUR MORE, 2026-08-09, when the signup KV's period was declared and its row
// moved to `rule: ttl`. That move is what exposed R4 as too weak to hold it:
// subscribe.js writes TWO KV values under TWO retention rules, so the RATE-LIMIT
// put's `expirationTtl` already satisfied "the anchor mentions expirationTtl"
// for the signup row — the new row's limb could not have failed on its own.
// `mechanism.ttlSource` (the exact source text that sets THIS store's expiry)
// is the repair, and these are its real-tree mutations:
//
//   R7  register `ttlSource` says 180, the code says 365 -> "does not contain that text"
//   R8  the code moved to 180, the register still says 365 -> same, from the other side
//   R9  the code reverted to `null` (period deleted)     -> same — a deleted period
//                                                          can no longer read as covered
//   R10 the rate-limit row's `ttlSource` removed         -> "with no `mechanism.ttlSource`"
//   4/4 caught, every restore byte-identical, guard re-verified green after each.
//
// ⚠️ FIVE MORE, 2026-08-13, for limb (v) — ONE NUMBER, ONE HOME. The period lived
// in THREE files (tooling/legal/data-inventory.json, tooling/ops/register.json,
// services/platform/src/scheduled.ts) with no check between the first two, so
// changing one left the others printing the old figure while every guard stayed
// green. Real-tree mutations, sha256 before and after each:
//
//   M1 the HOME moved 400 → 365 (events)          -> "RETENTION PERIODS DISAGREE …
//                                                     data-inventory.json:312 says 365 and
//                                                     register.json:1912 says 400"
//   M2 the COPY moved 730 → 1825 (provider_notif) -> same message from the other side
//   M3 the home's `periodDays` deleted (events_daily)
//                                                 -> "a copy with no home" (limb v-b),
//                                                    and the ⬜ count fell 3 → 2
//   M4 all three periods stripped from the home   -> COVERAGE LOST, "compares nothing"
//   M5 a period added under `kv:nikatru-signups`  -> "no rule for joining that id shape"
//                                                    (an unjoinable number must not read
//                                                    as a checked one)
//   5/5 caught. tooling/legal/data-inventory.json restored to
//   8cb50fed9744a8166796a184ab13185abf3fbc9fdb6066951dfd254a7ac805e3 and
//   tooling/ops/register.json to
//   163ffd78d41604f298ca056b11a7096d8ac0b419a85291d20990274422da2b39 — both the
//   pre-mutation hashes — and the guard re-verified green after every restore.
//
// ⚠️ AND A SIXTH, IN THE THIRD HOME, found by asking limb (v)'s question of the
// code rather than assuming the answer. ~~services/platform/test/retention-sweep.
// test.ts pairs scheduled.ts with the register~~ — it paired only TWO of the
// three stores: its `stores` array read ['events', 'provider_notifications'],
// while `EVENTS_DAILY_RETENTION_DAYS` was read into the `shipped` map and never
// asserted.
//
//   M6 EVENTS_DAILY_RETENTION_DAYS 1100 → 37, both registers left at 1100
//      BEFORE -> 40 tests pass; assert-retention-coverage and
//                assert-data-inventory both EXIT 0. Nothing red anywhere.
//      AFTER  -> "events_daily — and on WHAT the period is": expected 1100 to be 37.
//   Fixed rather than noted (one word in that array). scheduled.ts restored to
//   be07c219df7abb18394690af7877486a9dd5a624d883d92411aef39fae2c4164 and green.
//
// 📌 THE LESSON IS ABOUT WHAT COUNTS AS COVERAGE. `EVENTS_DAILY_RETENTION_DAYS`
// was imported, put in a map, and type-checked — it LOOKED covered from every
// angle except the one that matters, which is whether any assertion ranges over
// it. The list that drives `it.each` is the coverage; the map is only data.
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
CREATE TABLE IF NOT EXISTS swept_table (b TEXT);
`;

/** The stage-8 HOME of every retention period. The passing fixture declares one,
 *  so limb (v) is EXERCISED by the green baseline rather than skipped in it — a
 *  fixture that leaves a limb with nothing to compare proves only that the limb
 *  did not crash. */
function inventory(stores) {
  return JSON.stringify({ stores });
}

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
  mkdirSync(join(root, 'tooling/legal'), { recursive: true });
  const state = {
    rows: [
      retentionRow('d1:demo_db:real_table'),
      // The period pair. Its number lives in the inventory (the HOME) and is
      // COPIED here, which is the relationship limb (v) enforces.
      retentionRow('d1:demo_db:swept_table', {
        rule: 'period',
        periodDays: 400,
        keepWhy: undefined,
        deletingJob: 'a nightly sweep',
      }),
      retentionRow('kv:svc:CACHE'),
      { ...retentionRow('kv:external:thing'), id: 'retention.kv.external' },
    ],
    requiredIds: ['retention.kv.external'],
    inventoryStores: [
      { id: 'table:demo_db.real_table', retention: { kind: 'keep', reason: 'it is the record' } },
      { id: 'table:demo_db.swept_table', retention: { kind: 'swept', periodDays: 400, sweptBy: 'a nightly sweep' } },
    ],
  };
  mutate(state, root);
  writeFileSync(join(root, 'tooling/ops/register.json'), register(state.rows, state.requiredIds));
  if (state.inventoryStores !== null) {
    writeFileSync(join(root, 'tooling/legal/data-inventory.json'), inventory(state.inventoryStores));
  }
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
  /** A ttl row over `functions/sub.js`. `ttlSource` defaults to the line the
   *  passing fixture writes, so each test overrides only the thing it is about. */
  const ttlRow = ({ mechanism: mech = {}, ...rest } = {}) => ({
    ...retentionRow('kv:external:rl'),
    id: 'retention.kv.external',
    rule: 'ttl',
    keepWhy: undefined,
    ...rest,
    mechanism: {
      substrate: 'cloudflare-kv',
      anchor: 'functions/sub.js',
      record: 'the ttl',
      failingValue: 'a put without one',
      readBy: 'this guard',
      ttlSource: 'expirationTtl: 600',
      ...mech,
    },
  });

  const withSub = (body) => (s, r) => {
    mkdirSync(join(r, 'functions'), { recursive: true });
    writeFileSync(join(r, 'functions/sub.js'), body);
    s.requiredIds = ['retention.kv.external'];
  };

  test('a ttl rule whose anchor has no expirationTtl FAILS', () => {
    const root = makeRepo((s, r) => {
      withSub('await env.KV.put(key, value);\n')(s, r);
      s.rows.push(ttlRow());
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /contains no `expirationTtl`/);
  });

  test('a ttl rule whose anchor DOES carry the declared expiry passes', () => {
    const root = makeRepo((s, r) => {
      withSub('await env.KV.put(key, value, { expirationTtl: 600 });\n')(s, r);
      s.rows.push(ttlRow());
    });
    const r = run(root);
    assert.equal(r.code, 0, r.out);
  });

  test('a ttl rule anchored at a file that does not exist FAILS rather than passing unchecked', () => {
    const root = makeRepo((s) => {
      s.requiredIds = ['retention.kv.external'];
      s.rows.push(ttlRow({ mechanism: { anchor: 'functions/gone.js' } }));
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /does not exist, so the claim cannot be checked/);
  });

  test('a ttl rule with NO ttlSource FAILS — the field is what makes the limb row-specific', () => {
    const root = makeRepo((s, r) => {
      withSub('await env.KV.put(key, value, { expirationTtl: 600 });\n')(s, r);
      s.rows.push(ttlRow({ mechanism: { ttlSource: undefined } }));
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /with no `mechanism\.ttlSource`/);
  });

  test('an empty ttlSource is not a declaration', () => {
    const root = makeRepo((s, r) => {
      withSub('await env.KV.put(key, value, { expirationTtl: 600 });\n')(s, r);
      s.rows.push(ttlRow({ mechanism: { ttlSource: '   ' } }));
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /with no `mechanism\.ttlSource`/);
  });

  // 🔴 THE CASE THE REAL REPOSITORY IS. Two stores, two retention rules, ONE
  // anchor: sites/nikatru/functions/api/subscribe.js writes the rate-limit key
  // AND the signup record. Under the old check — "the anchor mentions
  // expirationTtl" — the rate-limit put satisfied the SIGNUP row, so the signup
  // row's ttl limb could not fail on its own and the register could have
  // claimed any period at all. This is that fixture, and it must be RED.
  test('a sibling rule\'s expirationTtl does NOT satisfy this row — one anchor, two stores', () => {
    const root = makeRepo((s, r) => {
      withSub('await env.KV.put(rl, "1", { expirationTtl: RATE_WINDOW_SECONDS });\nawait env.KV.put(sub, rec);\n')(s, r);
      s.rows.push(ttlRow({ mechanism: { ttlSource: 'const SIGNUP_RETENTION_DAYS = 365;' } }));
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /does not contain that text/);
    assert.match(r.out, /still asserting the old period/);
  });

  test('two ttl rows over one anchor each pass on THEIR OWN declared line', () => {
    const root = makeRepo((s, r) => {
      withSub('await env.KV.put(rl, "1", { expirationTtl: RATE_WINDOW_SECONDS });\nconst SIGNUP_RETENTION_DAYS = 365;\n')(s, r);
      s.requiredIds = ['retention.kv.external', 'retention.kv.external2'];
      s.rows.push(ttlRow({ mechanism: { ttlSource: 'expirationTtl: RATE_WINDOW_SECONDS' } }));
      s.rows.push({
        ...ttlRow({ mechanism: { ttlSource: 'const SIGNUP_RETENTION_DAYS = 365;' } }),
        id: 'retention.kv.external2',
        store: 'kv:external:sub',
      });
    });
    const r = run(root);
    assert.equal(r.code, 0, r.out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMB (v) — ONE NUMBER, ONE HOME.
//
// The fixtures below are the SHAPE coverage; the mutations that matter were run
// against the REAL tree (see the header, M1–M5). Both are kept for the reason
// this repo learned the hard way: a fixture encodes the same misunderstanding as
// the guard it tests, so fixtures alone are not evidence — and a real-tree
// mutation cannot be re-run in CI, so it is not coverage either.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-retention-coverage — a period has ONE home, and the register holds a derived copy', () => {
  test('the green baseline actually COMPARED a period — otherwise this limb proves nothing', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 declared period\(s\) cross-checked home→copy/);
  });

  test('the home and the copy disagreeing FAILS, naming both files and both values', () => {
    const root = makeRepo((s) => {
      s.inventoryStores = s.inventoryStores.map((x) =>
        x.id === 'table:demo_db.swept_table' ? { ...x, retention: { ...x.retention, periodDays: 30 } } : x,
      );
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /RETENTION PERIODS DISAGREE for `d1:demo_db:swept_table`/);
    assert.match(r.out, /tooling\/legal\/data-inventory\.json.* says 30/);
    assert.match(r.out, /tooling\/ops\/register\.json.* says 400/);
  });

  test('…and it fails identically when the REGISTER is the side that moved', () => {
    const root = makeRepo((s) => {
      s.rows = s.rows.map((r) => (r.store === 'd1:demo_db:swept_table' ? { ...r, periodDays: 30 } : r));
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /RETENTION PERIODS DISAGREE/);
    assert.match(r.out, /says 400 and .* says 30/);
  });

  // THE OTHER DIRECTION. Without it, deleting the inventory row is the way to
  // pass — the same "make the domain smaller" escape limb (ii) exists to refuse.
  //
  // ⚠️ A SECOND PERIOD IS PART OF THIS FIXTURE ON PURPOSE. Removing the only one
  // empties the home and the vacuity floor fires FIRST, which is correct but is a
  // different refusal; this test is about the surviving copy being named. Both
  // paths are failures either way — proven on the real tree, where deleting one
  // of three inventory periods produced exactly the message below (M3).
  test('a register period with NO home FAILS — deleting the home must not be the way to pass', () => {
    const root = makeRepo((s) => {
      s.inventoryStores = [
        { id: 'table:demo_db.real_table', retention: { kind: 'swept', periodDays: 90, sweptBy: 'a nightly sweep' } },
      ];
      s.rows = s.rows.map((r) =>
        r.store === 'd1:demo_db:real_table'
          ? { ...r, rule: 'period', periodDays: 90, keepWhy: undefined, deletingJob: 'a nightly sweep' }
          : r,
      );
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /declares `periodDays: 400`.*declares no period for it/s);
  });

  test('a home period whose store has no register row FAILS — a number with no deleting job', () => {
    const root = makeRepo((s) => {
      s.rows = s.rows.filter((r) => r.store !== 'd1:demo_db:swept_table');
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /carries no retention row for that store/);
  });

  test('a home period whose register row is not `rule: period` FAILS — nothing is obliged to enforce it', () => {
    const root = makeRepo((s) => {
      s.rows = s.rows.map((r) =>
        r.store === 'd1:demo_db:swept_table'
          ? { ...retentionRow('d1:demo_db:swept_table'), id: r.id }
          : r,
      );
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /calls it `rule: "keep"`/);
  });

  // A SKIP IS THE FAILURE MODE, NOT THE SAFE DEFAULT: an id shape the join rule
  // does not cover is a number cross-checked against nothing, printing green
  // beside three that are checked.
  test('a period under an id shape the join rule does not cover FAILS rather than being skipped', () => {
    const root = makeRepo((s) => {
      s.inventoryStores = [...s.inventoryStores, { id: 'kv:some-namespace', retention: { kind: 'swept', periodDays: 90 } }];
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /no rule for joining that id shape/);
  });

  test('a home declaring NO period at all is COVERAGE LOST, not "nothing to check"', () => {
    const root = makeRepo((s) => {
      s.inventoryStores = s.inventoryStores.filter((x) => x.id !== 'table:demo_db.swept_table');
      s.rows = s.rows.filter((r) => r.store !== 'd1:demo_db:swept_table');
    });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /declares no `retention\.periodDays` for any store/);
  });

  test('a missing home file is COVERAGE LOST — the comparison would have nothing to compare', () => {
    const root = makeRepo((s) => { s.inventoryStores = null; });
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /data-inventory\.json does not exist/);
  });

  test('an unparseable home is COVERAGE LOST, never a silent skip', () => {
    const root = makeRepo();
    writeFileSync(join(root, 'tooling/legal/data-inventory.json'), '{ not json');
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /could not be parsed/);
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

  // 🔴 THIS TEST WAS RE-POINTED 2026-08-12, AND THE COVERAGE MOVED RATHER THAN
  // BEING DELETED — the distinction is the whole point.
  //
  // It used to assert that the REAL repository still prints `PERIOD UNDECLARED`,
  // which was true while `events` and `provider_notifications` had no declared
  // period. [ADR 045] declared both (400 / 730 days), so that assertion became
  // false — and the tempting fix, deleting it, would have removed the ONLY
  // coverage of the print behaviour anywhere in this suite: nothing else
  // exercised `rule: 'period-undeclared'`. The guard would have kept a limb no
  // test could ever fail, which is this repository's signature defect.
  //
  // So the behaviour is now driven through a FIXTURE (below), where an
  // undeclared period can be constructed on purpose and will still be
  // constructible after every real gap is closed — and the real repository is
  // asserted to have NONE, which is the state ADR 045 actually reached.
  test('the real repository now has ZERO undeclared periods', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}
${r.stderr}`);
    assert.doesNotMatch(
      r.stdout,
      /PERIOD UNDECLARED/,
      'a period is undeclared again — either a new store arrived without one, or a declared ' +
        'period was reverted. Both are decisions, not accidents: declare it or say why.',
    );
  });

  test('…and the PRINT still works, proven on a fixture rather than on our own gap', () => {
    const root = makeRepo((s) => {
      s.rows = s.rows.map((r) =>
        r.store === 'd1:demo_db:real_table'
          ? { ...r, rule: 'period-undeclared', ownerGap: 'the owner has not chosen a number' }
          : r,
      );
    });
    const r = run(root);
    // It PRINTS and does NOT fail: an owner-gated gap must be visible on every
    // run without reddening a build over work only the owner can do (C-6).
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PERIOD UNDECLARED/);
    assert.match(r.out, /the owner has not chosen a number/);
  });
});
