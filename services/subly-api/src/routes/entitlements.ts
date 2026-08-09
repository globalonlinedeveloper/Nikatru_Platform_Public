// ─────────────────────────────────────────────────────────────────────────────
// /v1/entitlements — read this user's entitlements for THIS app from PLATFORM_DB.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows } from '../lib/d1';
import { isMoneyEnvironment } from '../lib/money';

const app = new Hono<AppEnv>();

/** The row shape this route reads. Named columns, not `SELECT *`: the shared
 *  table grows a column with every platform migration, and `*` would ship each
 *  one to every client without anybody deciding that. Same reasoning as
 *  services/platform/src/routes/entitlements.ts — a smaller subset, not the
 *  same one. Exported for the schema-witness test, which asserts every field
 *  here is a real column of the shipped platform migrations. */
export interface EntitlementRow {
  entitlement: string;
  product_id: string | null;
  store: string | null;
  is_active: number;
  expires_at: string | null;
  provider_environment: string | null;
}

// GET / — { app_id, is_pro, entitlements: [...] }
app.get('/', async (c) => {
  const userId = c.get('userId');
  const appId = c.env.APP_ID;

  // This deploy's money world. Undeclared is a 503 for the same reason the
  // webhook refuses: there is no safe default, and a read that guessed 'live'
  // would honour sandbox rows in production. [5]M-12
  const environment = c.env.MONEY_ENVIRONMENT;
  if (!isMoneyEnvironment(environment)) {
    console.error(
      `[entitlements] rid=${c.get('requestId')} MONEY_ENVIRONMENT is ${JSON.stringify(environment)} — ` +
        'refusing to decide access without knowing which money world this deploy is. [5]M-12',
    );
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  const rows = await allRows<EntitlementRow>(
    c.env.PLATFORM_DB.prepare(
      `SELECT entitlement, product_id, store, is_active, expires_at, provider_environment
         FROM entitlements
        WHERE user_id = ? AND app_id = ?`,
    ).bind(userId, appId),
  );

  const nowMs = Date.now();
  // `provider_environment` rides along so a denied row is DIAGNOSABLE from the
  // payload: with the environment limb there are two denial reasons, and
  // support cannot tell "wrong money world" from "unparseable expiry" if the
  // response hides the world. Same reason the platform route returns provider
  // and revocation fields.
  const entitlements = rows.map((r) => ({
    entitlement: r.entitlement,
    product_id: r.product_id,
    store: r.store,
    is_active: r.is_active === 1,
    expires_at: r.expires_at,
    provider_environment: r.provider_environment,
  }));

  // ── THE MONEY BOUNDARY — IT MUST FAIL CLOSED ────────────────────────────────
  // "Pro" = any active, unexpired entitlement for this app.
  //
  // The two absent-expiry cases are NOT the same and must not be collapsed:
  //
  //   · `expires_at IS NULL` — a LIFETIME grant. There is no end date because
  //     there is no end. Grants. This is a real RevenueCat shape
  //     (NON_RENEWING_PURCHASE), written deliberately by the webhook handler.
  //   · `expires_at` present but UNPARSEABLE — we do not know when this grant
  //     ends, which is not the same as knowing it never does. Previously this
  //     read `Number.isNaN(exp) ? true`, i.e. an expiry we could not decide
  //     GRANTED Pro, forever, to every reader of that row. A corrupted write, a
  //     future schema change, or an upstream that starts sending epoch-ms
  //     instead of ISO would all have silently unlocked the paywall rather than
  //     surfacing as anything at all.
  //
  // So: undecidable ⇒ NO access. The row is still returned in `entitlements` so
  // the client and support can see it exists; it just cannot buy anything.
  //
  // `''` moved SIDES with this change: the old `if (!r.expires_at) return true`
  // read it as lifetime. Nothing we write can produce it (the webhook writes an
  // ISO string or SQL NULL), so an empty string only ever means a row someone
  // or something else damaged — which is the undecidable case, not the lifetime
  // one. `Date.parse('')` is NaN, so it now denies. Same on the client
  // (packages/core .../entitlement.dart), so the two ends cannot disagree.
  const isPro = rows.some((r) => {
    if (r.is_active !== 1) return false;
    // [5]M-12 — the environment limb the platform route has had all along. A
    // row from the OTHER money world grants nothing here, and a row with NO
    // world at all is UNDECIDABLE — "written before the rail knew" is not
    // evidence of a live payment, so it denies too (fail closed, both rails'
    // writers stamp the column as of 2026-08-09).
    if (r.provider_environment !== environment) {
      console.warn(
        `[entitlements] rid=${c.get('requestId')} app=${appId} entitlement=${r.entitlement} — row's ` +
          `money environment is ${JSON.stringify(r.provider_environment)}, this deploy is '${environment}'. ` +
          'Denying. [5]M-12',
      );
      return false;
    }
    if (r.expires_at === null || r.expires_at === undefined) {
      return true; // lifetime
    }
    const exp = Date.parse(r.expires_at);
    if (Number.isNaN(exp)) {
      // Correlate by REQUEST ID, never by user id: `userId` is the Supabase JWT
      // `sub`, and this line lands in Workers Logs / Logpush, outside the
      // PiiScrubber seam every other sink goes through. The rid ties it to the
      // request that can be traced properly; nothing else here identifies a
      // person.
      console.warn(
        `[entitlements] rid=${c.get('requestId')} app=${appId} ` +
          `entitlement=${r.entitlement} — unparseable expires_at, denying (fail closed)`,
      );
      return false;
    }
    return exp > nowMs;
  });

  return c.json({
    app_id: appId,
    is_pro: isPro,
    entitlements,
  });
});

export default app;
