// ─────────────────────────────────────────────────────────────────────────────
// extDeviceAuth — the browser extension's per-device credential, and the ONE
// composite that lets it reach GET /v1/entitlements.
//
// ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT (design §3.4, G9). ADR 059 D10
// names one route the extension calls; D7 sets revocation per session. So the
// credential `nkx1_…` (minted once by POST /v1/ext/token, routes/ext.ts) is
// accepted on EXACTLY two requests — `GET /v1/entitlements` and
// `POST /v1/ext/revoke` — and answered 401 everywhere else it is tried.
//
// ── WHAT IT DOES NOT TOUCH ───────────────────────────────────────────────────
// It never calls Supabase. middleware/auth.ts stays the only file in this Worker
// that knows the identity provider; a device bearer is recognised by its
// `nkx1_` prefix and looked up in D1 by its SHA-256, and anything else is handed
// to `platformAuth` unchanged. The credential itself is never stored, logged,
// echoed or put in an error body — only its hash is compared.
//
// ── THE STATUS CODES ARE A CONTRACT WITH THE EXTENSION ───────────────────────
//   401  the credential is dead (unknown, or revoked) — the extension DELETES it.
//   403  the credential is alive but for another product.
//   503  D1 could not answer — the extension HOLDS its last answer.
// 🔴 A D1 FAILURE MUST NEVER READ AS 401: the extension deletes its credential
// on a 401, so an outage answered 401 would sign every Pro user out at once.
//
// ── WHAT IT SETS ─────────────────────────────────────────────────────────────
// `userId`, exactly as `platformAuth` does, and NOTHING else. `platformAuth`
// also sets `userEmail` and `authRecency`, which account routes read; a device
// credential must never be able to supply either, so neither is ever set here.
// ─────────────────────────────────────────────────────────────────────────────
import type { Context, MiddlewareHandler } from 'hono';
import { bearer } from '../../../_shared/src/auth';
import type { AppEnv } from '../types';
import { platformAuth } from './auth';

/** The device credential's prefix. A version tag, so a future format is a new
 *  prefix rather than a guess about which shape a string is. */
export const EXT_TOKEN_PREFIX = 'nkx1_';

/** Lower-case hex SHA-256 of a UTF-8 string — how a code or a credential is
 *  stored and looked up. Never the value itself. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The device credential on this request, or null when the bearer is anything
 *  else (absent, a JWT, a string without the prefix). */
export function deviceBearer(c: Context<AppEnv>): string | null {
  const token = bearer(c.req.header('Authorization') ?? '');
  return token !== null && token.startsWith(EXT_TOKEN_PREFIX) ? token : null;
}

/** Midnight UTC of `nowMs`, ISO — `last_seen_at` is written at most once a day. */
function utcDayStart(nowMs: number): string {
  return `${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00.000Z`;
}

interface DeviceRow {
  link_id: string;
  user_id: string;
  product: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export const extDeviceAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = deviceBearer(c);
  if (token === null) return c.json({ error: 'unauthorized' }, 401);

  let row: DeviceRow | null;
  try {
    row = await c.env.PLATFORM_DB.prepare(
      'SELECT link_id, user_id, product, last_seen_at, revoked_at FROM ext_devices WHERE token_hash = ?',
    )
      .bind(await sha256Hex(token))
      .first<DeviceRow>();
  } catch {
    // 🔴 503, NEVER 401 — see the header. Nothing about the request is logged:
    // the one value that identifies it is the credential.
    console.warn(`[ext-device-auth] rid=${c.get('requestId') ?? '-'} device lookup failed — 503`);
    return c.json({ error: 'service_unavailable' }, 503);
  }
  if (row === null || row.revoked_at !== null) return c.json({ error: 'unauthorized' }, 401);

  // A device is linked to ONE product. `app_id` is how GET /v1/entitlements
  // names the product it asks about; a request that names another is refused
  // here, before any read, and a request that names none reaches no read that
  // could answer for another product (POST /v1/ext/revoke carries no app_id).
  const asked = c.req.query('app_id');
  if (asked !== undefined && asked !== row.product) return c.json({ error: 'wrong_product' }, 403);

  // `last_seen_at` at most once per UTC day, by a GUARDED write, so a busy
  // device costs one D1 write a day rather than one per read. Best-effort: a
  // failed write never changes the answer.
  const now = Date.now();
  const dayStart = utcDayStart(now);
  if (row.last_seen_at === null || row.last_seen_at < dayStart) {
    try {
      await c.env.PLATFORM_DB.prepare(
        'UPDATE ext_devices SET last_seen_at = ? WHERE link_id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)',
      )
        .bind(new Date(now).toISOString(), row.link_id, dayStart)
        .run();
    } catch {
      console.warn(`[ext-device-auth] rid=${c.get('requestId') ?? '-'} last_seen_at write failed — ignored`);
    }
  }

  c.set('userId', row.user_id);
  await next();
  return;
};

/**
 * THE COMPOSITE for the `/v1/entitlements` tree — the one line index.ts mounts
 * on `/v1/entitlements/*`.
 *
 * 🔴 WHY ONE PATH-AWARE MIDDLEWARE AND NOT A COMPOSITE ON `/v1/entitlements`.
 * MEASURED against this Worker's real router (test/ext-auth.test.ts, hono
 * 4.13.8): `app.use('/v1/entitlements/*', …)` ALSO matches the exact path
 * `/v1/entitlements`. A device-aware middleware on the exact path alone would
 * let the credential through, and the `/*` line's `platformAuth` would then
 * answer 401 anyway. So the tree has ONE middleware, and it decides:
 *
 *   · exactly `GET /v1/entitlements` with an `nkx1_` bearer → extDeviceAuth;
 *   · EVERY other request in the tree → platformAuth, unchanged.
 *
 * `/v1/entitlements/subject`, and any sub-route added later, is therefore
 * JWT-only BY DEFAULT: a device credential there is handed to `platformAuth`,
 * which refuses it as an unverifiable JWT.
 */
export const entitlementsAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'GET' && c.req.path === '/v1/entitlements' && deviceBearer(c) !== null) {
    return extDeviceAuth(c, next);
  }
  return platformAuth(c, next);
};
