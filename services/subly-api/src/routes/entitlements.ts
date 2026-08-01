// ─────────────────────────────────────────────────────────────────────────────
// /v1/entitlements — read this user's entitlements for THIS app from PLATFORM_DB.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv, Entitlement } from '../types';
import { allRows } from '../lib/d1';

const app = new Hono<AppEnv>();

// GET / — { app_id, is_pro, entitlements: [...] }
app.get('/', async (c) => {
  const userId = c.get('userId');
  const appId = c.env.APP_ID;

  const rows = await allRows<Entitlement>(
    c.env.PLATFORM_DB.prepare(
      'SELECT * FROM entitlements WHERE user_id = ? AND app_id = ?',
    ).bind(userId, appId),
  );

  const nowMs = Date.now();
  const entitlements = rows.map((r) => ({
    entitlement: r.entitlement,
    product_id: r.product_id,
    store: r.store,
    is_active: r.is_active === 1,
    expires_at: r.expires_at,
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
