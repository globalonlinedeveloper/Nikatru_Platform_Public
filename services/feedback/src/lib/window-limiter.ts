// ─────────────────────────────────────────────────────────────────────────────
// window-limiter.ts — a `RateLimiter` (services/_shared/src/ports/ratelimit.ts)
// over the SQL port, for windows a Workers Rate Limiting binding cannot count
// (lane feedback-intake, Do 6).
//
// WHY NOT THE BINDING. A Rate Limiting binding's period is 10 s or 60 s; the
// brief's bound is "the 4th anonymous report in an HOUR from one key", and a
// global DAILY cap. A KV counter would read stale under exactly the burst it is
// for (services/platform/wrangler.jsonc says why), so the count is a D1 row:
// one UPSERT per request, read back in the same statement.
//
// 🔴 THE KEY IS NEVER STORED, AND NEITHER IS THE ADDRESS (C-NO-NETWORK-ADDRESS-
// COLUMN). The caller passes a key — `user:<sub>` or `addr:<client address>` —
// and this module stores only SHA-256(salt ‖ key) truncated to 16 hex characters.
// The salt is 32 random bytes minted per window and kept in
// `feedback_rate_salts` only while its window is live; `prune` deletes it with
// the window's counts. Once a window's salt is gone, nothing can recompute any
// key's hash, so even a 2^32 address space cannot be walked back from a row.
//
// FAILURE POLICY: `limit` rejects on a store error, as the port says; the route
// decides (it fails CLOSED with 503: an intake with no limit is the spam door).
// ─────────────────────────────────────────────────────────────────────────────
import type { RateLimiter } from '../../../_shared/src/ports/ratelimit';
import type { SqlDb } from '../../../_shared/src/ports/sql';

const HASH_HEX = 16;

export interface WindowLimiterOptions {
  /** The window, in milliseconds. */
  windowMs: number;
  /** Requests admitted per key per window. */
  limit: number;
  /** 0 for the hour windows, 1 for the day window: added to the aligned start
   *  (both lengths are whole seconds), so the two never share a window id, a
   *  salt or a prune. */
  scope: 0 | 1;
  /** The clock; tests pass their own. */
  now?: () => number;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** The salt of the window starting at `windowStart`, minted on first use. */
async function saltFor(db: SqlDb, windowStart: number): Promise<string> {
  await db
    .prepare('INSERT INTO feedback_rate_salts (window_start, salt) VALUES (?, ?) ON CONFLICT (window_start) DO NOTHING')
    .bind(windowStart, randomHex(32))
    .run();
  const row = await db.prepare('SELECT salt FROM feedback_rate_salts WHERE window_start = ?').bind(windowStart).first<{ salt: string }>();
  if (!row) throw new Error('feedback_rate_salts: the salt row was not readable after its insert');
  return row.salt;
}

/** The hash a key is stored under in its window. Exported for the tests. */
export async function keyHash(db: SqlDb, windowStart: number, key: string): Promise<string> {
  return (await sha256Hex(`${await saltFor(db, windowStart)}\u0000${key}`)).slice(0, HASH_HEX);
}

export function windowLimiter(db: SqlDb, options: WindowLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  return {
    async limit({ key }) {
      // A window is identified by its start, aligned to its own length, plus its
      // scope: the hour and day limiters never share a window id or a salt.
      const windowStart = Math.floor(now() / options.windowMs) * options.windowMs + options.scope;
      const hash = await keyHash(db, windowStart, key);
      const row = await db
        .prepare(
          'INSERT INTO feedback_rate_windows (window_start, key_hash, n) VALUES (?, ?, 1) ' +
            'ON CONFLICT (window_start, key_hash) DO UPDATE SET n = n + 1 RETURNING n',
        )
        .bind(windowStart, hash)
        .first<{ n: number }>();
      return { success: Number(row?.n ?? Number.POSITIVE_INFINITY) <= options.limit };
    },
  };
}

/** Delete every window (counts AND salt) that has ended: an hour window
 *  (scope 0) older than `hourBefore`, the day window (scope 1) older than `dayBefore`. */
export async function pruneWindows(db: SqlDb, hourBefore: number, dayBefore: number): Promise<number> {
  const ended = '(window_start % 1000 = 0 AND window_start < ?) OR (window_start % 1000 = 1 AND window_start < ?)';
  const res = await db.batch([
    db.prepare(`DELETE FROM feedback_rate_windows WHERE ${ended}`).bind(hourBefore, dayBefore),
    db.prepare(`DELETE FROM feedback_rate_salts WHERE ${ended}`).bind(hourBefore, dayBefore),
  ]);
  return res.reduce((n, r) => n + Number(r.meta?.changes ?? 0), 0);
}
