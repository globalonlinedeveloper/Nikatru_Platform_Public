// ─────────────────────────────────────────────────────────────────────────────
// ext-links.ts — how long a linked browser's credential lives, and the ONE
// statement that ends every link an account has.
//
// ⏱ 2026-09-30 · EXA-11 (round-2 review, O-EXTENSION-ACCOUNT-CHECK-UNBUILT). The
// device credential (`nkx1_…`, routes/ext.ts) was minted with NO lifetime and
// ended only when the browser revoked itself or the account was erased. So a
// browser linked by somebody who had the password kept reading the account's
// FullShot entitlement after the owner reset that password or signed out
// everywhere. Three doors now end a link from the ACCOUNT side, and all three
// use `revokeUserLinks` below:
//
//   · POST /v1/sessions/revoke-all — "sign out everywhere" ends every link too.
//   · a recovery sign-in — platformAuth (middleware/auth.ts) passes the instant
//     GoTrue recorded a `recovery` authentication, and every link made BEFORE
//     it is revoked. GoTrue runs the password reset itself and tells this
//     Worker nothing, so the recovery session reaching the Worker is the reset
//     as the Worker can see it; the lifetime below bounds the case where it
//     never does.
//   · DELETE /v1/ext/devices/:link_id — the account revokes ONE browser and
//     leaves the others working (routes/ext.ts).
//
// And the credential expires on its own (`extLinkExpired`): unused for
// EXT_LINK_IDLE_DAYS, or older than EXT_LINK_MAX_AGE_DAYS however used. An
// expired link answers 401, the answer the extension reads as "delete this
// credential", and it is re-linked on https://nikatru.com/ext/connect.
//
// Every instant here is ISO-8601 TEXT, as 0017_ext_devices.sql requires.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A link nobody has used for 30 days is dead. The extension checks at most once
 * a day while it is used and holds Pro offline for at most 7 days (design §3.3),
 * so a browser still in use is never near this; one that has been put away is
 * re-linked in one sign-in.
 *
 * @ceiling none — a credential lifetime we chose (EXA-11), not a platform resource.
 */
export const EXT_LINK_IDLE_DAYS = 30;

/**
 * No link outlives 180 days, however often it is used — the bound on the one
 * case no account-side door reaches: a stolen credential on a browser whose
 * holder never lets it go idle, on an account that never signs out everywhere
 * and never reaches this Worker with a recovery session.
 *
 * @ceiling none — a credential lifetime we chose (EXA-11), not a platform resource.
 */
export const EXT_LINK_MAX_AGE_DAYS = 180;

// @ceiling none — a unit conversion (milliseconds in a day), not a cap on any platform resource.
const MS_PER_DAY = 86400000;

/**
 * True when the link can no longer authenticate by AGE. Fail-closed: an
 * unparseable `created_at` is expired, because a credential whose age cannot be
 * read cannot be shown to be inside its lifetime. `last_seen_at` is written at
 * most once a UTC day (middleware/ext-device-auth.ts), so idleness is measured
 * from the later of it and `created_at`.
 */
export function extLinkExpired(row: { created_at: string; last_seen_at: string | null }, nowMs: number): boolean {
  const created = Date.parse(row.created_at);
  if (!Number.isFinite(created)) return true;
  if (nowMs - created >= EXT_LINK_MAX_AGE_DAYS * MS_PER_DAY) return true;
  const seen = row.last_seen_at === null ? Number.NaN : Date.parse(row.last_seen_at);
  const lastUse = Number.isFinite(seen) && seen > created ? seen : created;
  return nowMs - lastUse >= EXT_LINK_IDLE_DAYS * MS_PER_DAY;
}

/**
 * Revokes every live link of `userId`; with `createdBefore`, only the links
 * made before that instant — so a browser the owner links AFTER a reset is not
 * ended by the recovery session that preceded it. Answers the number of links
 * revoked. Throws on a D1 failure; each caller decides what that means.
 */
export async function revokeUserLinks(
  db: D1Database,
  userId: string,
  nowIso: string,
  createdBefore?: string,
): Promise<number> {
  const res =
    createdBefore === undefined
      ? await db
          .prepare('UPDATE ext_devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
          .bind(nowIso, userId)
          .run()
      : await db
          .prepare('UPDATE ext_devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND created_at < ?')
          .bind(nowIso, userId, createdBefore)
          .run();
  return Number(res.meta?.changes ?? 0);
}
