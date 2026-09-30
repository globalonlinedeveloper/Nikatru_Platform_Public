// ─────────────────────────────────────────────────────────────────────────────
// Idempotency-Key for creates — AB-O2-02, the server half of the offline outbox
// (audit D22, ST-N5).
//
// 🔴 WHAT WAS BROKEN. `POST /v1/subscriptions` minted a fresh `uuid()` per
// request and took no key. A create that COMMITTED but whose response was lost
// (a receive timeout, a dropped connection) looked to the app exactly like one
// that never arrived, so the retry inserted a second row. An outbox that
// replays writes on reconnect turns that one-off into a duplicate generator,
// which is why this lands first and the app's outbox second.
//
// 🔴 THE ROW ID IS DERIVED FROM (user, key), SO THE PRIMARY KEY IS THE LOCK.
// With a key, the id is SHA-256("subscriptiontracker/create", user id, key),
// formatted as a UUID. The first attempt inserts that id; a repeat finds it and
// is answered with the row, 200 instead of 201. Two attempts racing both miss
// the lookup, one INSERT wins and the other hits the primary key — and is
// answered with the winner's row rather than a 500. No new column and no
// migration: the id space is the one every row already lives in, and the user
// id inside the hash means two accounts can never meet on one key.
//
// ⚠️ A KEY IS OPTIONAL. A request without one behaves exactly as before (a
// fresh `uuid()`), so an old client keeps working through the deploy. A key
// that is present but malformed is a 400 — a client that meant to be safe and
// is not should hear about it, not be quietly downgraded.
//
// ⚠️ PATCH IS IDEMPOTENT BY CONSTRUCTION and takes no key here: it SETS the
// fields it names, so a replay writes the same values again. The header is on
// the shared CORS allow-list so a browser may send it on any write.
// ─────────────────────────────────────────────────────────────────────────────
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** A key is 8-128 URL-safe characters: a UUID fits, and so does a ULID. */
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** The id a keyed create reserves, per request. */
const reserved = new WeakMap<Request, string>();

/** The row id [key] maps to for [userId] — stable, and private to the user. */
export async function idempotentRowId(userId: string, key: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`subscriptiontracker/create\n${userId}\n${key}`),
    ),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // version 8: a custom, name-derived UUID
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The id this request's keyed create must insert, or undefined without a key. */
export function reservedCreateId(c: Context<AppEnv>): string | undefined {
  return reserved.get(c.req.raw);
}

/**
 * Middleware in front of a create handler. With a valid key it answers a
 * repeat from [existing] (200), otherwise reserves the derived id for the
 * handler, and turns a lost insert race into the winner's row.
 */
export function idempotentCreate(
  existing: (c: Context<AppEnv>, id: string) => Promise<Response | null>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_HEADER);
    if (key === undefined) return next();
    if (!KEY_RE.test(key)) {
      return c.json(
        { error: 'invalid_idempotency_key', detail: 'Idempotency-Key must be 8-128 of A-Z a-z 0-9 _ -' },
        400,
      );
    }
    const id = await idempotentRowId(c.get('userId'), key);
    const replay = await existing(c, id);
    if (replay) return replay;

    reserved.set(c.req.raw, id);
    await next();
    if (c.error) {
      // Lost the race to a concurrent attempt with the same key: its row is
      // the answer. Anything else is a real failure and keeps its 500.
      const winner = await existing(c, id);
      if (winner) {
        c.res = undefined;
        c.res = winner;
      }
    }
  };
}
