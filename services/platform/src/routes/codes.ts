// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/codes/redeem — OUR OWN OFFER CODES (lane growth-codes, Do 2;
// O-PROMO-CODES-NO-REDEEM-ROUTE).
//
//   body    { code, idempotencyKey }   → 200 { offer, app, months, expiresAt, replay }
//
// AUTHED (src/index.ts mounts `platformAuth` on /v1/codes/*): the subject is
// the verified session's `sub`. RATE-LIMITED: `REDEEM_PER_MINUTE` attempts per
// account per minute (tooling/catalog/offers.json codePolicy), counted in D1 by
// the same window limiter the private intake uses — the next attempt is 429, so
// a code cannot be guessed by trial. IDEMPOTENT: the same idempotency key, or
// the same code again, answers the FIRST outcome and writes nothing — a replay
// grants once. HASHED: the code is compared by its SHA-256 (src/lib/codes/
// verify.ts) and never stored or logged. CAPPED and EXPIRING: the cap is taken
// in the same UPDATE that checks it, so two concurrent redeems cannot both take
// the last redemption.
//
// WHAT IT GRANTS: the free months of the offer the code names, as a
// `promo_code` bundle grant (src/lib/codes/grant.ts) — never an AI allowance.
// On a channel whose store bills (App Store, Play) the app renders NO code
// field (packages/purchases redeem_code.dart; tooling/catalog/offers.json
// `channels`): those codes are the store's own and never reach this route.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { readBoundedBody } from '../lib/body';
import { firstRow, nowIso, run, uuid } from '../lib/d1';
import { isMoneyEnvironment } from '../lib/mor/contract';
import { windowLimiter } from '../feedback/window-limiter';
import { codeVerifier, normaliseCode, codeHash } from '../lib/codes/verify';
import { grantPromoMonths } from '../lib/codes/grant';
import { FREE_OFFERS, REDEEM_PER_MINUTE, type FreeOffer } from '../lib/codes/offers';

/** @ceiling none — a request-shape bound: a code and a key. */
export const REDEEM_MAX_BYTES = 512;
/** @ceiling none — the limiter's window, one minute. */
export const REDEEM_WINDOW_MS = 60_000;

/** Keys that would DECIDE a grant. A body naming one is refused out loud (assert-bundle-provenance limb 6). */
export const GRANT_DECIDING_KEYS = ['source', 'featureSetName', 'featureSetVersion', 'expiresAt', 'months', 'userId', 'appId', 'offer', 'offerId'];

const IDEMPOTENCY = /^[A-Za-z0-9_-]{8,80}$/;

interface RedemptionRow {
  offer_id: string;
  app_id: string;
  expires_at: string;
}

const monthsOf = (offers: readonly FreeOffer[], id: string): number | null => offers.find((o) => o.id === id)?.months ?? null;

/** The router over a register; the default export reads the bundled one. Tests pass their own. */
export function codesRoutes(offers: readonly FreeOffer[] = FREE_OFFERS, perMinute: number = REDEEM_PER_MINUTE) {
  const codes = new Hono<AppEnv>();

  codes.post('/codes/redeem', async (c) => {
    const userId = c.get('userId');
    const environment = c.env.MONEY_ENVIRONMENT;
    if (!isMoneyEnvironment(environment)) return c.json({ error: 'money_rail_not_configured' }, 503);
    const db = c.env.PLATFORM_DB;
    let admitted: boolean;
    try {
      admitted = (await windowLimiter(db, { windowMs: REDEEM_WINDOW_MS, limit: perMinute, scope: 0 }).limit({ key: `codes:user:${userId}` })).success;
    } catch {
      return c.json({ error: 'unavailable' }, 503);
    }
    if (!admitted) return c.json({ error: 'rate_limited' }, 429);

    const read = await readBoundedBody(c.req.raw, REDEEM_MAX_BYTES);
    if (!read.ok) return read.status === 413 ? c.json({ error: read.error }, 413) : c.json({ error: read.error }, 400);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(read.bytes));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return c.json({ error: 'bad_json' }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return c.json({ error: 'bad_json' }, 400);
    }
    const offered = GRANT_DECIDING_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(body, k));
    if (offered.length > 0) return c.json({ error: 'client_supplied_grant', keys: offered }, 400);
    if (Object.keys(body).some((k) => k !== 'code' && k !== 'idempotencyKey')) return c.json({ error: 'invalid' }, 422);
    const code = normaliseCode(body.code);
    const key = typeof body.idempotencyKey === 'string' && IDEMPOTENCY.test(body.idempotencyKey) ? body.idempotencyKey : null;
    if (code === null || key === null) return c.json({ error: 'invalid' }, 422);

    // A retry of this request, or this code redeemed by this account before: the first outcome, nothing written.
    const hash = await codeHash(code);
    const prior = await firstRow<RedemptionRow>(
      db.prepare('SELECT offer_id, app_id, expires_at FROM offer_redemptions WHERE user_id = ? AND (idempotency_key = ? OR code_hash = ?)').bind(userId, key, hash),
    );
    if (prior !== null) {
      return c.json({ offer: prior.offer_id, app: prior.app_id, months: monthsOf(offers, prior.offer_id), expiresAt: prior.expires_at, replay: true }, 200);
    }

    const at = nowIso();
    const verdict = await codeVerifier(db).verify(code, at);
    if (verdict.kind === 'unknown') return c.json({ error: 'unknown_code' }, 404);
    if (verdict.kind === 'expired') return c.json({ error: 'expired' }, 410);
    if (verdict.kind === 'exhausted') return c.json({ error: 'exhausted' }, 409);
    const offer = offers.find((o) => o.id === verdict.row.offer_id && o.app === verdict.row.app_id && o.kind === 'free-month' && o.status === 'live');
    if (offer === undefined) return c.json({ error: 'offer_not_live' }, 503);

    // The redemption row first (its UNIQUEs refuse a concurrent replay), then the cap, in one UPDATE.
    const redemptionId = `RD-${uuid()}`;
    const inserted = await run(
      db
        .prepare(
          `INSERT INTO offer_redemptions (redemption_id, code_hash, user_id, offer_id, app_id, idempotency_key, grant_id, expires_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
        )
        .bind(redemptionId, hash, userId, offer.id, offer.app, key, redemptionId, at, at),
    );
    if ((inserted.meta?.changes ?? 0) === 0) {
      const raced = await firstRow<RedemptionRow>(
        db.prepare('SELECT offer_id, app_id, expires_at FROM offer_redemptions WHERE user_id = ? AND (idempotency_key = ? OR code_hash = ?)').bind(userId, key, hash),
      );
      if (raced === null) return c.json({ error: 'unavailable' }, 503);
      return c.json({ offer: raced.offer_id, app: raced.app_id, months: monthsOf(offers, raced.offer_id), expiresAt: raced.expires_at, replay: true }, 200);
    }
    const taken = await run(
      db.prepare('UPDATE offer_codes SET redeemed = redeemed + 1 WHERE code_hash = ? AND redeemed < max_redemptions AND expires_at > ?').bind(hash, at),
    );
    if ((taken.meta?.changes ?? 0) === 0) {
      await run(db.prepare('DELETE FROM offer_redemptions WHERE redemption_id = ?').bind(redemptionId));
      return c.json({ error: 'exhausted' }, 409);
    }
    const granted = await grantPromoMonths(
      { db, environment },
      { userId, appId: offer.app, months: offer.months, grantKey: redemptionId, operator: `code:${verdict.row.issued_by}`, nowIso: at },
    );
    await run(db.prepare('UPDATE offer_redemptions SET expires_at = ? WHERE redemption_id = ?').bind(granted.expiresAt, redemptionId));
    return c.json({ offer: offer.id, app: offer.app, months: offer.months, expiresAt: granted.expiresAt, replay: false }, 200);
  });

  return codes;
}

export default codesRoutes();
