// ─────────────────────────────────────────────────────────────────────────────
// provision-reviewer-accounts.test.mjs — the two store-review accounts
// (tooling/ops/provision-reviewer-accounts.mjs), driven through a fake GoTrue and
// a fake D1 HTTP endpoint that executes against platform_db with EVERY real
// migration applied (money-dry-run.mjs makeOpsDb). The Pro grant runs the real
// one writer (upsertBundleGrant) and is read back by the real one reader
// (readProductEntitlement), so "Pro" in these tests is what the app would hear.
// Nothing here reaches a network; no value printed is a password.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Refused, appendVault, newPassword, readVault, run } from '../../ops/provision-reviewer-accounts.mjs';
import { makeOpsDb } from '../../ops/money-dry-run.mjs';

const REPO = join(import.meta.dirname, '..', '..', '..');
const AUTH = 'https://auth-api.nikatru.com';
const SERVICE = 'service-role-test-value';

/** A vault with the credentials the run reads, in a temporary directory. */
function vault(extra = '') {
  const dir = mkdtempSync(join(tmpdir(), 'nk-reviewers-'));
  const path = join(dir, 'secrets.env');
  writeFileSync(path, `SUPABASE_URL=${AUTH}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE}\nCLOUDFLARE_ACCOUNT_ID=acct\nCLOUDFLARE_API_TOKEN=cf-token\n${extra}`);
  return { dir, path };
}

/** A GoTrue admin API in memory, and a D1 HTTP API over a migrated platform_db. */
function backend({ users = [] } = {}) {
  const state = { users: users.map((u) => ({ ...u })), calls: [] };
  const db = makeOpsDb(REPO);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    state.calls.push(`${method} ${u.pathname}`);
    if (u.origin === AUTH) {
      assert.equal(init.headers.apikey, SERVICE);
      if (method === 'GET' && u.pathname === '/auth/v1/admin/users') {
        const f = u.searchParams.get('filter') ?? '';
        return json(200, { users: state.users.filter((x) => x.email.includes(f)) });
      }
      if (method === 'POST' && u.pathname === '/auth/v1/admin/users') {
        const b = JSON.parse(init.body);
        const id = `00000000-0000-4000-8000-${String(state.users.length + 1).padStart(12, '0')}`;
        state.users.push({ id, email: b.email, password: b.password, app_metadata: b.app_metadata, confirmed: b.email_confirm });
        return json(200, { id });
      }
      const m = u.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
      if (method === 'PUT' && m) {
        const user = state.users.find((x) => x.id === m[1]);
        Object.assign(user, { password: JSON.parse(init.body).password });
        return json(200, { id: user.id });
      }
    }
    if (u.hostname === 'api.cloudflare.com') {
      const { sql, params } = JSON.parse(init.body);
      const stmt = db.prepare(sql).bind(...params);
      const r = /^\s*SELECT/i.test(sql) ? await stmt.all() : await stmt.run();
      return json(200, { success: true, result: [{ results: r.results ?? [], meta: { changes: r.meta?.changes ?? 0 } }] });
    }
    return json(404, { error: `no fake for ${method} ${url}` });
  };
  return { state, db, fetchImpl };
}

const target = async () => ({ dbId: '9d1c5c63-97fe-4f82-bc7d-f3fd22e9b351', environment: 'live' });

function capture() {
  const lines = [];
  return { lines, log: (l) => lines.push(String(l)) };
}

describe('provision-reviewer-accounts', () => {
  test('a password is four typeable groups with upper, lower and digit', () => {
    for (let i = 0; i < 50; i++) {
      const p = newPassword();
      assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{5}(-[A-HJ-NP-Za-km-z2-9]{5}){3}$/);
      assert.ok(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p));
    }
  });

  test('🔴 the vault is append-only: the same value is a no-op, another value is a refusal, nothing is rewritten', () => {
    const v = vault('REVIEWER_FREE_EMAIL=review-free@nikatru.com\n');
    try {
      assert.equal(appendVault(v.path, 'REVIEWER_FREE_EMAIL', 'review-free@nikatru.com'), false);
      assert.throws(() => appendVault(v.path, 'REVIEWER_FREE_EMAIL', 'other@nikatru.com'), (e) => e instanceof Refused && e.code === 1);
      assert.equal(appendVault(v.path, 'REVIEWER_FREE_USER_ID', 'x'), true);
      assert.match(readFileSync(v.path, 'utf8'), /REVIEWER_FREE_EMAIL=review-free@nikatru\.com\nREVIEWER_FREE_USER_ID=x\n$/);
    } finally {
      rmSync(v.dir, { recursive: true, force: true });
    }
  });

  test('the default PLAN writes nothing: no user, no vault line', async () => {
    const v = vault();
    const b = backend();
    const before = readFileSync(v.path, 'utf8');
    const out = capture();
    try {
      await run({ root: REPO, vault: v.path, env: {}, fetchImpl: b.fetchImpl, log: out.log });
      assert.deepEqual(b.state.calls.filter((c) => !c.startsWith('GET')), []);
      assert.equal(readFileSync(v.path, 'utf8'), before);
      assert.match(out.lines.join('\n'), /PLAN \(reads only; --apply writes\)/);
    } finally {
      rmSync(v.dir, { recursive: true, force: true });
    }
  });

  test('🔴 --apply makes both users, puts each password in the vault FIRST, prints none, and a re-run changes nothing', async () => {
    const v = vault();
    const b = backend();
    const out = capture();
    try {
      await run({ root: REPO, vault: v.path, env: {}, fetchImpl: b.fetchImpl, log: out.log, apply: true });
      const held = readVault(v.path);
      assert.equal(b.state.users.length, 2);
      for (const [role, email] of [['FREE', 'review-free@nikatru.com'], ['PRO', 'review-pro@nikatru.com']]) {
        const user = b.state.users.find((u) => u.email === email);
        assert.ok(user && user.confirmed === true, `${email} was not made pre-confirmed`);
        assert.equal(held.get(`REVIEWER_${role}_PASSWORD`), user.password, `${email}'s password is not the vault's`);
        assert.equal(held.get(`REVIEWER_${role}_USER_ID`), user.id);
        assert.equal(user.app_metadata.store_review, role.toLowerCase());
        assert.ok(!out.lines.join('\n').includes(user.password), 'a password was printed');
      }
      const vaultBefore = readFileSync(v.path, 'utf8');
      await run({ root: REPO, vault: v.path, env: {}, fetchImpl: b.fetchImpl, log: () => {}, apply: true });
      assert.equal(b.state.users.length, 2, 'a re-run made a second user');
      assert.equal(readFileSync(v.path, 'utf8'), vaultBefore, 'a re-run rewrote the vault');
    } finally {
      rmSync(v.dir, { recursive: true, force: true });
    }
  });

  test('a user that exists with no password in the vault gets a new one, set on the account and appended', async () => {
    const v = vault();
    const b = backend({ users: [{ id: '00000000-0000-4000-8000-0000000000aa', email: 'review-pro@nikatru.com', password: 'unknown' }] });
    try {
      await run({ root: REPO, vault: v.path, env: {}, fetchImpl: b.fetchImpl, log: () => {}, apply: true });
      const user = b.state.users.find((u) => u.email === 'review-pro@nikatru.com');
      assert.notEqual(user.password, 'unknown');
      assert.equal(readVault(v.path).get('REVIEWER_PRO_PASSWORD'), user.password);
      assert.ok(b.state.calls.includes('PUT /auth/v1/admin/users/00000000-0000-4000-8000-0000000000aa'));
    } finally {
      rmSync(v.dir, { recursive: true, force: true });
    }
  });

  test('🔴 an address outside nikatru.com, or in the throwaway E2E shape the sweep deletes, is refused', async () => {
    const v = vault();
    const b = backend();
    try {
      for (const proEmail of ['review@example.com', 'subscriptiontracker-e2e+1700000000000@nikatru.com']) {
        await assert.rejects(
          run({ root: REPO, vault: v.path, env: {}, fetchImpl: b.fetchImpl, log: () => {}, apply: true, proEmail }),
          (e) => e instanceof Refused && e.code === 1,
        );
      }
      assert.equal(b.state.users.length, 0);
    } finally {
      rmSync(v.dir, { recursive: true, force: true });
    }
  });

  test('🔴 --grant-pro with no minted comp set is COVERAGE LOST (exit 2) and writes no grant', async () => {
    const v = vault();
    const b = backend();
    try {
      await assert.rejects(
        run({ root: REPO, vault: v.path, env: {}, fetchImpl: b.fetchImpl, log: () => {}, apply: true, grantPro: true, platformTarget: target }),
        (e) => e instanceof Refused && e.code === 2 && /is not a member of store_review_comp's served version/.test(e.lines[0]),
      );
      const rows = (await b.db.prepare('SELECT COUNT(*) AS n FROM bundle_grants').all()).results[0].n;
      assert.equal(rows, 0);
    } finally {
      rmSync(v.dir, { recursive: true, force: true });
    }
  });

  test('🔴 --grant-pro --mint-comp-set: the one writer grants owner_comp, the one reader says Pro for the Pro account and NOT for the free one', async () => {
    const v = vault();
    const b = backend();
    const out = capture();
    try {
      const r = await run({ root: REPO, vault: v.path, env: {}, fetchImpl: b.fetchImpl, log: out.log, apply: true, grantPro: true, mintCompSet: true, platformTarget: target, now: () => new Date('2026-10-04T00:00:00Z') });
      assert.deepEqual(r.pro, { isPro: true, via: 'bundle' });
      const g = (await b.db.prepare('SELECT source, provider, provider_environment, feature_set_name, expires_at, provider_transaction_id FROM bundle_grants').all()).results;
      assert.equal(g.length, 1);
      assert.equal(g[0].source, 'owner_comp');
      assert.equal(g[0].provider_environment, 'live');
      assert.equal(g[0].feature_set_name, 'store_review_comp');
      assert.equal(g[0].expires_at, '2027-10-04T00:00:00.000Z');
      assert.match(g[0].provider_transaction_id, /^operator-record:/);
      const set = (await b.db.prepare('SELECT status FROM feature_sets WHERE name = ?').bind('store_review_comp').all()).results;
      assert.deepEqual(set.map((s) => s.status), ['draft']);
      // A second apply is the same grant (the upsert key is the reviewer), not a second one.
      await run({ root: REPO, vault: v.path, env: {}, fetchImpl: b.fetchImpl, log: () => {}, apply: true, grantPro: true, platformTarget: target, now: () => new Date('2026-10-05T00:00:00Z') });
      assert.equal((await b.db.prepare('SELECT COUNT(*) AS n FROM bundle_grants').all()).results[0].n, 1);
      assert.match(out.lines.join('\n'), /read back: review-pro@nikatru\.com is_pro true via bundle; review-free@nikatru\.com is_pro false/);
    } finally {
      rmSync(v.dir, { recursive: true, force: true });
    }
  });
});
