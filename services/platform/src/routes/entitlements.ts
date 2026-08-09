// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/entitlements?app_id=<id> — ANY app reads ITS entitlement from the host
// every stamped app already has.
//
// [pipeline 5]M-4. Unblocked by stage 4's [4]B-3 landing `platformAuth` on this
// Worker; this route is the money half that lift existed for.
//
// WHY IT LIVES HERE AND NOT IN A PER-APP WORKER. The brick's DEFAULT stamp is
// CLIENT-ONLY — it deploys no Worker of its own ([ADR 020]). Until now the only
// working entitlement read in the repo was inside `services/subly-api`, i.e.
// inside the one legacy app that happens to have a backend, so every app the
// factory stamps had no way to ask whether its user had paid. Fifty apps cannot
// each grow a Worker to answer one question about a table they all share.
//
// ── 🔴 THE ORIGINAL ACCEPTANCE CRITERION COULD NOT FAIL ──────────────────────
// "An unauthenticated request to the same route is refused" is satisfied by a
// route that DOES NOT EXIST: a 404 is non-2xx, i.e. "refused". Three things
// replace it, and a 404 satisfies none of them:
//   1. an unauthenticated request returns **401 specifically**;
//   2. a token signed by the LEGACY HS256 shared secret is rejected — the
//      shared Worker deliberately has no symmetric fallback (middleware/auth.ts
//      records why), and that divergence has to be exercised, not asserted;
//   3. a request for **app B never returns app A's rows** — the app_id scoping
//      limb the whole shared-table design rests on, and which had no test
//      anywhere before this file.
//
// ── THE MONEY BOUNDARY, AND IT FAILS CLOSED ON EVERY UNDECIDABLE CASE ────────
// This is a straight port of the fixed logic in
// `services/subly-api/src/routes/entitlements.ts:32-75` — NOT of the version
// that shipped before it, which read an unparseable `expires_at` as `is_pro:
// true`, i.e. a lifetime grant to anybody whose row was damaged. The two
// absent-expiry cases stay distinct:
//   · `expires_at IS NULL`      — a LIFETIME grant. No end date because there is
//                                 no end. Grants.
//   · present but UNPARSEABLE   — we do not know when it ends, which is NOT the
//                                 same as knowing it never does. Denies.
//
// ⚠️ AND ONE LIMB THE LEGACY ROUTE DOES NOT HAVE: THE ENVIRONMENT. [5]M-12 —
// a row records which money world granted it, and a reader in the other world
// must see nothing. A row whose `provider_environment` does not equal this
// deploy's is not honoured, and a row with NO environment at all is UNDECIDABLE
// and is therefore also not honoured. That second case is the fail-closed rule
// applied to itself: "written before the rail knew" is not evidence of a live
// payment. The RevenueCat writer sets the column as of 2026-08-09 (with the
// same fail-closed world guard and the M-2 ordering clause), so both of this
// table's writers now stamp their world; that rail itself stays owner-deferred.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows } from '../lib/d1';
import { isKnownApp } from '../config';
import { isMoneyEnvironment } from '../lib/mor/contract';

const entitlements = new Hono<AppEnv>();

/** The row shape this route reads. A subset of the table on purpose: `SELECT *`
 *  would ship every column added by every future migration to every client. */
interface EntitlementRow {
  entitlement: string;
  product_id: string | null;
  store: string | null;
  is_active: number;
  expires_at: string | null;
  provider: string | null;
  provider_environment: string | null;
  provider_status: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  revocation_reason: string | null;
}

entitlements.get('/entitlements', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';

  // THE APP IS A REQUEST PARAMETER, and it must be one this factory knows.
  // On a per-app Worker the app is `c.env.APP_ID`; on the SHARED host it cannot
  // be, or every app would read the same row. An unknown id is a 404 rather than
  // an empty list: an empty list says "you own nothing here", which is a
  // different and misleading answer to "there is no such app".
  const appId = c.req.query('app_id') ?? '';
  if (!isKnownApp(appId)) {
    return c.json({ error: 'unknown_app' }, 404);
  }
  c.set('appId', appId); // [pipeline B-16] attribution, post-validation.

  // This deploy's money world. Undeclared is a 503 for the same reason the
  // webhook refuses: there is no safe default, and a read that guessed 'live'
  // would honour sandbox rows in production.
  const environment = c.env.MONEY_ENVIRONMENT;
  if (!isMoneyEnvironment(environment)) {
    console.error(
      `[entitlements] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(environment)} — refusing to decide ` +
        'access without knowing which money world this deploy is. [5]M-12',
    );
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  // 🔴 BOTH PREDICATES, ALWAYS. `user_id` alone would return every app's rows
  // for this user; `app_id` alone would return every user's rows for this app.
  // The shared table's entire safety rests on this one line.
  const rows = await allRows<EntitlementRow>(
    c.env.PLATFORM_DB.prepare(
      `SELECT entitlement, product_id, store, is_active, expires_at,
              provider, provider_environment, provider_status,
              current_period_end, trial_end, revocation_reason
         FROM entitlements
        WHERE user_id = ? AND app_id = ?`,
    ).bind(userId, appId),
  );

  const nowMs = Date.now();

  /** Whether ONE row grants access. Every branch that cannot decide denies. */
  const grants = (r: EntitlementRow): boolean => {
    if (r.is_active !== 1) return false;
    if (r.provider_environment !== environment) {
      // Correlate by REQUEST ID, never by user id — `userId` is the Supabase
      // `sub` and this line lands in Workers Logs, outside the PiiScrubber seam.
      console.warn(
        `[entitlements] rid=${rid} app=${appId} entitlement=${r.entitlement} — row's money environment is ` +
          `${JSON.stringify(r.provider_environment)}, this deploy is '${environment}'. Denying. [5]M-12`,
      );
      return false;
    }
    if (r.expires_at === null || r.expires_at === undefined) return true; // lifetime
    const exp = Date.parse(r.expires_at);
    if (Number.isNaN(exp)) {
      console.warn(
        `[entitlements] rid=${rid} app=${appId} entitlement=${r.entitlement} — unparseable expires_at, ` +
          'denying (fail closed)',
      );
      return false;
    }
    return exp > nowMs;
  };

  return c.json({
    app_id: appId,
    is_pro: rows.some(grants),
    // The rows are returned even when they grant nothing, so a client and a
    // support conversation can both see that a row EXISTS and why it is inert.
    // Refusing silently is what makes a paid user's lockout unexplainable.
    entitlements: rows.map((r) => ({
      entitlement: r.entitlement,
      product_id: r.product_id,
      store: r.store,
      is_active: r.is_active === 1,
      expires_at: r.expires_at,
      provider: r.provider,
      provider_status: r.provider_status,
      current_period_end: r.current_period_end,
      trial_end: r.trial_end,
      revocation_reason: r.revocation_reason,
    })),
  });
});

export default entitlements;
