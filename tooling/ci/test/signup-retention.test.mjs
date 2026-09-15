// ─────────────────────────────────────────────────────────────────────────────
// signup-retention.test.mjs — WHERE A nikatru.com SIGNUP IS STORED, AND THAT IT
// IS BOUNDED. [ADR 087], rewritten 2026-09-15.
//
// Until 2026-09-15 this suite held the KV retention seam in
// sites/nikatru/functions/api/subscribe.js: a `sub:<email>` put carrying
// `expirationTtl` from `SIGNUP_RETENTION_DAYS`. [ADR 087] moved the list to table
// `signups` in platform_db (APAC) and kept only the `rl:` rate-limit counter in
// the KV namespace. A D1 table has no expiry, so the period (still 400 days) is
// now enforced by the platform Worker's nightly `retentionSweep` — tested
// against the real schema in services/platform/test/retention-sweep.test.ts.
// What stays HERE is the site half, which no Worker test can reach:
//
//   · the Function writes the signup to PLATFORM_DB and never a `sub:` key to KV;
//   · a repeat signup, in any letter case, writes nothing and keeps the ORIGINAL
//     signup time — the time the 400 days are counted from;
//   · 🔴 with PLATFORM_DB unbound it fails exactly as it does with SIGNUPS
//     unbound (503) and NEVER falls back to KV — the fallback would silently put
//     an email address back in the store the move exists to leave;
//   · the row is the published promise: two columns, email and time;
//   · the register, the migration and the sweep constant agree on the period.
//
// 🔴 THE D1 DOUBLE IS A REAL SQL ENGINE. `node:sqlite` applies the real
// services/platform/migrations/0011_signups.sql, so ON CONFLICT and COLLATE
// NOCASE are executed, not modelled — a recorder cannot tell an INSERT naming a
// column no migration created from a correct one (services/platform/test/harness.ts).
// The module under test is the real file, imported unmodified.
//
// NEGATIVE-TESTED (2026-09-15, real mutations of the real file, restored after):
//   N1 the binding check reverted to `!env.SIGNUPS` only        -> the unbound-D1 case
//   N2 a `sub:` put added back beside the INSERT                 -> the no-KV-list case
//   N3 `ON CONFLICT(email) DO NOTHING` -> `DO UPDATE SET signed_up_at = excluded.signed_up_at`
//                                                                -> the original-time case
//   N4 `COLLATE NOCASE` dropped from the migration                -> the letter-case case
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { stripSourceComments } from '../text-reductions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SUBSCRIBE_REL = 'sites/nikatru/functions/api/subscribe.js';
const MIGRATION_REL = 'services/platform/migrations/0011_signups.sql';
const SCHEDULED_REL = 'services/platform/src/scheduled.ts';
const REGISTER_REL = 'tooling/ops/register.json';

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const load = () => import(pathToFileURL(join(REPO, SUBSCRIBE_REL)).href);

/** A D1 binding over a real SQLite database holding the real 0011 schema. */
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(read(MIGRATION_REL));
  const sent = [];
  let fail = false;
  return {
    db,
    sent,
    failNext() { fail = true; },
    rows: () => db.prepare('SELECT email, signed_up_at FROM signups ORDER BY signed_up_at, email').all().map((r) => ({ ...r })),
    binding: {
      prepare(sql) {
        return {
          bind: (...args) => ({
            run: async () => {
              sent.push({ sql, args });
              if (fail) throw new Error('D1_ERROR: simulated');
              const r = db.prepare(sql).run(...args);
              return { success: true, meta: { changes: Number(r.changes) } };
            },
          }),
        };
      },
    },
  };
}

/** A KV binding that records every write. */
function kv() {
  const puts = [];
  return { puts, binding: { list: async () => ({ keys: [] }), get: async () => null, put: async (...a) => { puts.push(a); } } };
}

const req = (email, ip = null) => ({
  headers: {
    get: (h) => {
      const k = String(h).toLowerCase();
      if (k === 'content-type') return 'application/json';
      if (k === 'cf-connecting-ip') return ip;
      return null;
    },
  },
  json: async () => ({ email }),
});

describe('the signup lands in platform_db, and only there', () => {
  test('a valid signup inserts one row: the address as submitted, and an ISO signup time', async () => {
    const { onRequestPost } = await load();
    const D = d1();
    const K = kv();
    const before = Date.now();
    const res = await onRequestPost({ request: req('Someone@Example.test'), env: { PLATFORM_DB: D.binding, SIGNUPS: K.binding } });
    assert.equal(res.status, 200);
    const rows = D.rows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, 'Someone@Example.test');
    assert.match(rows[0].signed_up_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.ok(Date.parse(rows[0].signed_up_at) >= before - 1000);
  });

  test('🔴 no `sub:` key and no email reaches KV — with no salt the Function writes nothing to KV at all', async () => {
    const { onRequestPost } = await load();
    const D = d1();
    const K = kv();
    await onRequestPost({ request: req('someone@example.test', '203.0.113.9'), env: { PLATFORM_DB: D.binding, SIGNUPS: K.binding } });
    assert.deepEqual(K.puts, [], 'the list moved to D1; any KV write here without a salt is the list leaking back');
  });

  test('with the salt set, the ONLY KV write is the one-hour `rl:` counter, and it carries no address', async () => {
    const { onRequestPost } = await load();
    const D = d1();
    const K = kv();
    await onRequestPost({
      request: req('someone@example.test', '203.0.113.9'),
      env: { PLATFORM_DB: D.binding, SIGNUPS: K.binding, SUBSCRIBE_RATE_LIMIT_SALT: 'test-salt-not-a-secret' },
    });
    assert.equal(K.puts.length, 1);
    const [key, value, opts] = K.puts[0];
    assert.match(key, /^rl:[0-9a-f]{32}:[0-9a-f-]{36}$/);
    assert.equal(value, '1');
    assert.deepEqual(opts, { expirationTtl: 3600 });
    assert.ok(!JSON.stringify(K.puts).includes('example.test'), 'an address reached KV');
    assert.equal(D.rows().length, 1);
  });

  test('the Function sends exactly one statement, and it is the exported SIGNUP_INSERT', async () => {
    const mod = await load();
    const D = d1();
    await mod.onRequestPost({ request: req('someone@example.test'), env: { PLATFORM_DB: D.binding, SIGNUPS: kv().binding } });
    assert.equal(D.sent.length, 1);
    assert.equal(D.sent[0].sql, mod.SIGNUP_INSERT);
    assert.match(mod.SIGNUP_INSERT, /^INSERT INTO signups \(email, signed_up_at\) VALUES \(\?, \?\) ON CONFLICT\(email\) DO NOTHING$/);
  });
});

describe('a repeat signup keeps the ORIGINAL signup time', () => {
  test('the same address again writes nothing and the first time stands', async () => {
    const { onRequestPost } = await load();
    const D = d1();
    D.db.exec("INSERT INTO signups (email, signed_up_at) VALUES ('someone@example.test', '2026-01-01T00:00:00.000Z')");
    const res = await onRequestPost({ request: req('someone@example.test'), env: { PLATFORM_DB: D.binding, SIGNUPS: kv().binding } });
    assert.equal(res.status, 200, 'a repeat signup is still a success to the visitor');
    assert.deepEqual(D.rows(), [{ email: 'someone@example.test', signed_up_at: '2026-01-01T00:00:00.000Z' }]);
  });

  test('a different letter case is the SAME signup, not a second row', async () => {
    const { onRequestPost } = await load();
    const D = d1();
    D.db.exec("INSERT INTO signups (email, signed_up_at) VALUES ('someone@example.test', '2026-01-01T00:00:00.000Z')");
    await onRequestPost({ request: req('SOMEONE@EXAMPLE.TEST'), env: { PLATFORM_DB: D.binding, SIGNUPS: kv().binding } });
    assert.deepEqual(D.rows(), [{ email: 'someone@example.test', signed_up_at: '2026-01-01T00:00:00.000Z' }]);
  });
});

describe('🔴 no binding, no signup — and never a KV fallback', () => {
  test('PLATFORM_DB unbound is a 503 and nothing is written anywhere', async () => {
    const { onRequestPost } = await load();
    const K = kv();
    const res = await onRequestPost({
      request: req('someone@example.test', '203.0.113.9'),
      env: { SIGNUPS: K.binding, SUBSCRIBE_RATE_LIMIT_SALT: 'test-salt-not-a-secret' },
    });
    assert.equal(res.status, 503);
    assert.deepEqual(K.puts, [], 'with the list store missing, a KV write of any kind is a fallback');
  });

  test('SIGNUPS unbound is the same 503, with the same message', async () => {
    const { onRequestPost } = await load();
    const D = d1();
    const noKv = await onRequestPost({ request: req('someone@example.test'), env: { PLATFORM_DB: D.binding } });
    const noD1 = await onRequestPost({ request: req('someone@example.test'), env: { SIGNUPS: kv().binding } });
    assert.equal(noKv.status, 503);
    assert.deepEqual(await noKv.json(), await noD1.json());
    assert.deepEqual(D.rows(), []);
  });

  test('a D1 failure is a 500, and the address does not go to KV instead', async () => {
    const { onRequestPost } = await load();
    const D = d1();
    const K = kv();
    D.failNext();
    const res = await onRequestPost({ request: req('someone@example.test'), env: { PLATFORM_DB: D.binding, SIGNUPS: K.binding } });
    assert.equal(res.status, 500);
    assert.deepEqual(K.puts, []);
  });
});

describe('the stored row IS the published promise, and the period is one number in three places', () => {
  test('the migration creates exactly two columns: email and signed_up_at', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(read(MIGRATION_REL));
    const cols = db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all('signups').map((r) => r.name);
    assert.deepEqual(
      cols,
      ['email', 'signed_up_at'],
      'sites/nikatru/privacy.html promises "your email address and the time you signed up, and nothing else"; a third column makes it false',
    );
  });

  test('the code of subscribe.js writes no `sub:` key — the KV list writer is gone, not commented out', () => {
    const code = stripSourceComments(read(SUBSCRIBE_REL), '.js');
    assert.doesNotMatch(code, /["'`]sub:/, 'a `sub:` key literal is back in the code');
    assert.match(code, /env\.PLATFORM_DB\.prepare\(SIGNUP_INSERT\)/);
  });

  test('register periodDays, the sweep constant and the ADR agree: 400 days', () => {
    const m = read(SCHEDULED_REL).match(/^export const SIGNUPS_RETENTION_DAYS = (\d+);$/m);
    assert.ok(m, `${SCHEDULED_REL} no longer declares SIGNUPS_RETENTION_DAYS`);
    const reg = JSON.parse(read(REGISTER_REL));
    const row = reg.rows.find((r) => r.id === 'retention.d1.platform_db.signups');
    assert.ok(row, 'retention.d1.platform_db.signups is gone from the register');
    assert.equal(row.rule, 'period');
    assert.equal(row.periodDays, Number(m[1]));
    assert.equal(Number(m[1]), 400, '[ADR 087] carries the 400-day period over unchanged; moving it is an owner decision');
    assert.equal(
      reg.rows.some((r) => r.id === 'retention.kv.nikatru-signups.signup'),
      false,
      'the KV `sub:` retention row must retire with the KV writer — a row describing a writer that no longer exists is a stale claim',
    );
  });
});
