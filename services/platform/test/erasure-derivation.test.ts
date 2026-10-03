// ─────────────────────────────────────────────────────────────────────────────
// DELETE /v1/account ON THE SHARED WORKER — the erasure ENTRY POINT, and until
// 2026-08-09 the route with no test at all.
//
// 🔬 THE DEFECT THIS FILE IS BORN FROM. The delete set was derived with ONE
// correlated join — `FROM sqlite_master m JOIN pragma_table_info(m.name) p` —
// and D1 REJECTS that form with `not authorized: SQLITE_AUTH` (error 7500). The
// route caught the throw and answered `503 account_deletion_failed` BEFORE its
// service-role and endpoint limbs ever ran, so every in-app account deletion in
// production failed while `SUPABASE_SERVICE_ROLE_KEY` and
// `APP_ERASURE_ENDPOINTS` were both perfectly fine. Measured live that day with
// a real ES256 user token against the deployed Worker, and reproduced against
// both live databases through the D1 HTTP API.
//
// ⚠️ AND THE REGRESSION TEST FOR IT CANNOT BE WRITTEN HERE. This harness runs
// real SQL through `node:sqlite`, which has no D1 authorizer and ACCEPTS the
// correlated join — verified directly, not assumed. A test that ran the old
// query and expected a rejection would pass on the BROKEN implementation too.
// So what is pinned below is what can honestly be pinned locally: that the
// two-step walk derives the set the real migrations imply, that internal tables
// are never swept, and that the fail-closed limbs still refuse. The rejection
// itself needs a live D1 in the loop, and nothing in CI has one —
// `assert-erasure-reach.mjs` reads MIGRATION FILES, so a query D1 refuses at
// runtime looks entirely reachable to it. Named, not closed.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import account from '../src/routes/account';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const ENV = {
  APP_ID: 'platform',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  APP_ERASURE_ENDPOINTS: 'subscriptiontracker=https://subscriptiontracker-api.nikatru.com',
};

/** Drive the REAL route. The relay to each app and the identity delete are the
 *  only things stubbed — everything else, including the derivation under test,
 *  is the code that ships. */
async function erase(db: RealDb, env: Partial<typeof ENV> = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', 'u-derive');
    c.set('requestId', 'test');
    // What platformAuth sets on every admitted request (a password account); the
    // route refuses without it since O-APP-API-DELETE-NO-RECENCY.
    c.set('authRecency', { passwordless: false, linked: false, lastAuthenticatedAt: null });
    await next();
  });
  app.route('/v1', account);
  const res = await app.request(
    'http://x/v1/account',
    { method: 'DELETE', headers: { Authorization: 'Bearer test' } },
    { ...ENV, ...env, PLATFORM_DB: db },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

afterEach(() => vi.unstubAllGlobals());

/** Both outbound hops answer OK: the app relay, then the GoTrue identity delete. */
function stubHops() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
}

describe('the delete set is derived from the real platform schema', () => {
  it('🔴 names EXACTLY platform_db’s user-owned tables — the set production has', async () => {
    stubHops();
    const { status, body } = await erase(realPlatformDb());
    expect(status).toBe(200);
    // Pinned. A migration that adds a user-owned table turns this red, which is
    // the point: joining the erasure sweep must be a deliberate act.
    // `identity` is not a table — the route adds it after the GoTrue delete.
    expect(Object.keys(body.deleted as Record<string, number>).sort()).toEqual([
      // ⏱ 2026-10-02 · 0028 (T17). Spelt `user_id` ON PURPOSE: a user's AI credits, opt-in and call
      // ledger leave with the account.
      'ai_accounts',
      'ai_ledger',
      // 0009's bundle grants. THE DERIVATION WORKING AGAIN: the migration spelled
      // its column `user_id`, so the route empties the table with no edit to the
      // route, and this fixture is the only thing that had to move.
      'bundle_grants',
      'cancellation_requests',
      // ⏱ 2026-09-18 · 0013. Spelt `user_id` ON PURPOSE: a reporter who deletes
      // their account takes their reports (and the note they typed) with them.
      'content_reports',
      'entitlements',
      // ⏱ 2026-09-24 · the extension account check. Spelt `user_id` ON PURPOSE:
      // erasing the account deletes every one-time code and every linked device,
      // and a deleted device row answers 401 — the credential dies with it.
      'ext_codes',
      'ext_devices',
      // ⏱ 2026-09-30 · EXA-11 (0021): the per-account link floor leaves with the account.
      'ext_link_floor',
      // ⏱ 2026-10-03 · 0025, lane feedback-intake. Spelt `user_id` ON PURPOSE: a
      // signed-in reporter's "Report a problem" reports leave with the account, and
      // the platform's nightly feedback orphan sweep (src/feedback/cron.ts) then deletes their screenshots.
      'feedback_reports',
      'identity',
      // ⏱ 2026-10-03 · 0031, lane dpdp-rights. Spelt `user_id` ON PURPOSE: a
      // person's nominee and their rights requests leave with the account.
      'privacy_nominees',
      'privacy_requests',
      'provider_accounts',
      'provider_notifications',
      // ⏱ 2026-10-02 · 0026 (PR #1149). Spelt `user_id` ON PURPOSE: a buyer's payment → subscription
      // links leave with the account.
      'provider_payment_links',
      // ⏱ 2026-09-28 · 0020, renewal reminders. Spelt `user_id` ON PURPOSE:
      // erasing the account deletes the email preference, the sent ledger and the
      // calendar feed — a deleted feed row answers the same 404 as a revoked one.
      // ⏱ 2026-10-02 · 0029 (refund-finish). Spelt `user_id` ON PURPOSE: a person's refund
      // requests leave with the account.
      'refund_requests',
      'reminder_feed',
      'reminder_prefs',
      'reminder_sent',
    ]);

    // 🔑 AND THE OTHER SPELLING IS LIVE, NOT SPECULATIVE. `unclaimed_payments`
    // carries `claimed_user_id`, so platform_db really does hold a row that
    // REFERENCES a user without being theirs. It must be UNLINKED and must never
    // appear in `deleted` — the distinction the second limb exists for, with a
    // real instance behind it rather than a hypothetical.
    expect(Object.keys(body.unlinked as Record<string, number>)).toEqual([
      'unclaimed_payments.claimed_user_id',
    ]);
    expect(Object.keys(body.deleted as Record<string, number>)).not.toContain(
      'unclaimed_payments',
    );
  });

  it('deletes only this user’s rows', async () => {
    stubHops();
    const db = realPlatformDb();
    db.db.exec(
      `INSERT INTO entitlements (user_id, app_id, entitlement, is_active)
         VALUES ('u-derive','subscriptiontracker','pro',1), ('u-other','subscriptiontracker','pro',1)`,
    );
    const { status } = await erase(db);
    expect(status).toBe(200);
    expect(db.rows('SELECT user_id FROM entitlements').map((r) => r.user_id)).toEqual([
      'u-other',
    ]);
  });

  it('sqlite/d1 internal tables are never delete targets', async () => {
    stubHops();
    const db = realPlatformDb(['CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, user_id TEXT)']);
    const { body } = await erase(db);
    expect(Object.keys(body.deleted as Record<string, number>)).not.toContain('_cf_KV');
  });

  it('🔑 `*_user_id` is UNLINKED, never deleted, and the sets stay disjoint', async () => {
    stubHops();
    const db = realPlatformDb([
      `CREATE TABLE audit_trail (id TEXT PRIMARY KEY, actor_user_id TEXT)`,
      `INSERT INTO audit_trail (id, actor_user_id) VALUES ('a1','u-derive'), ('a2','u-other')`,
    ]);
    const { status, body } = await erase(db);
    expect(status).toBe(200);
    const deleted = Object.keys(body.deleted as Record<string, number>);
    const unlinked = Object.keys(body.unlinked as Record<string, number>).sort();
    expect(deleted).not.toContain('audit_trail');
    // Joins the one platform_db already has, rather than replacing it.
    expect(unlinked).toEqual([
      'audit_trail.actor_user_id',
      'unclaimed_payments.claimed_user_id',
    ]);
    // Disjoint by construction: nothing is both swept and unlinked.
    expect(deleted.filter((t) => unlinked.some((u) => u.startsWith(`${t}.`)))).toEqual([]);
    expect(db.rows('SELECT id, actor_user_id FROM audit_trail ORDER BY id')).toEqual([
      { id: 'a1', actor_user_id: null },
      { id: 'a2', actor_user_id: 'u-other' },
    ]);
  });

  it('the derivation runs BEFORE the fail-closed limbs it used to mask', async () => {
    // 🔴 THE SHAPE OF THE PRODUCTION BUG, INVERTED. The throw happened first, so
    // 503 came back while the service-role and endpoint limbs were never
    // reached — and every diagnosis pointed at those. With the derivation
    // working, a MISSING service-role key must produce its OWN 501, not a 503.
    stubHops();
    const { status, body } = await erase(realPlatformDb(), {
      SUPABASE_SERVICE_ROLE_KEY: '',
    });
    expect(status).toBe(501);
    expect(body.error).toBe('account_deletion_unconfigured');
  });
});
