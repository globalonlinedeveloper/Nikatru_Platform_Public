// ─────────────────────────────────────────────────────────────────────────────
// ext-links.ts — how long a linked browser's credential lives, and the ONE
// statement that ends every link an account has.
//
// ⏱ 2026-09-30 · EXA-11 (round-2 review, O-EXTENSION-ACCOUNT-CHECK-UNBUILT). The
// device credential (`nkx1_…`, routes/ext.ts) was minted with NO lifetime and
// ended only when the browser revoked itself or the account was erased.
//
// ⏱ 2026-09-30 (re-review finding 1, lead ruling) — A STANDING FLOOR, NOT A
// ONE-TIME UPDATE. The first cut revoked the links CREATED before a reset,
// once. A session that signed in before the reset still holds a valid access
// token for up to an hour, and with it could mint a link AFTER the reset. So:
//
//   · every code and link carries `auth_at` — when the minting session
//     STARTED (middleware/auth.ts `sessionStartedAt`: the OLDEST `amr`
//     timestamp, which neither a refresh nor a TOTP step-up moves; null, and so
//     older than any floor, when the token carries no `amr`);
//   · every account may carry a floor, `ext_link_floor.not_before`
//     (0021_ext_link_floor.sql), raised to the server's now by
//       - POST /v1/sessions/revoke-all ("sign out everywhere"), and
//       - a recovery session reaching the Worker (middleware/auth.ts), ONCE per
//         GoTrue session;
//   · a link, a code at exchange, or a mint whose `auth_at` is before the floor
//     is refused (`predatesFloor`), whenever it was minted. The owner's own
//     re-link after the reset comes from a fresh sign-in and passes.
//
// DELETE /v1/ext/devices/:link_id ends ONE browser and leaves the others.
//
// And the credential expires on its own (`extLinkExpired`): unused for
// EXT_LINK_IDLE_DAYS, or older than EXT_LINK_MAX_AGE_DAYS however used. Every
// refusal is the same 401 the extension reads as "delete this credential", and
// the browser is re-linked on https://nikatru.com/ext/connect.
//
// Every instant here is ISO-8601 TEXT, as 0017_ext_devices.sql requires.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../_shared/src/ports/sql';

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
 * True when a link (or a code) minted by a session that started at
 * `authAt` is below the account's floor `notBefore`. No floor → false. With a
 * floor, fail-closed: a NULL or unparseable `authAt` (a link minted before
 * 0021) is older than any floor, and an unparseable floor refuses everything.
 */
export function predatesFloor(authAt: string | null | undefined, notBefore: string | null | undefined): boolean {
  if (notBefore === null || notBefore === undefined) return false;
  const floor = Date.parse(notBefore);
  if (!Number.isFinite(floor)) return true;
  if (authAt === null || authAt === undefined) return true;
  const at = Date.parse(authAt);
  return !Number.isFinite(at) || at < floor;
}

/**
 * Raises the account's floor to `nowIso` (never lowers it). With
 * `recoverySession`, the write happens only if that GoTrue session has not
 * raised it already — the recovery door writes once per session, however many
 * requests the session makes and however many isolates serve them. Answers
 * whether a row changed. Throws on a D1 failure; each caller decides what that
 * means.
 */
export async function raiseLinkFloor(
  db: SqlDb,
  userId: string,
  nowIso: string,
  recoverySession?: string,
): Promise<boolean> {
  const res =
    recoverySession === undefined
      ? await db
          .prepare(
            'INSERT INTO ext_link_floor (user_id, not_before, recovery_session, updated_at) VALUES (?, ?, NULL, ?) ON CONFLICT(user_id) DO UPDATE SET not_before = MAX(ext_link_floor.not_before, excluded.not_before), updated_at = excluded.updated_at',
          )
          .bind(userId, nowIso, nowIso)
          .run()
      : await db
          .prepare(
            'INSERT INTO ext_link_floor (user_id, not_before, recovery_session, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET not_before = MAX(ext_link_floor.not_before, excluded.not_before), recovery_session = excluded.recovery_session, updated_at = excluded.updated_at WHERE ext_link_floor.recovery_session IS NOT excluded.recovery_session',
          )
          .bind(userId, nowIso, recoverySession, nowIso)
          .run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/** The account's floor, or null. Throws on a D1 failure. */
export async function linkFloorOf(db: SqlDb, userId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT not_before FROM ext_link_floor WHERE user_id = ?')
    .bind(userId)
    .first<{ not_before: string }>();
  return row?.not_before ?? null;
}
