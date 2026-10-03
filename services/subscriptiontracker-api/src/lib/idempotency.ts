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
// 🔴 THE ROW ID IS DERIVED FROM (user, key), AND A LEDGER ROW IS THE LOCK.
// With a key, the id is SHA-256("subscriptiontracker/create", user id, key),
// formatted as a UUID, and the key is CLAIMED in `idempotency_keys`
// (migrations/0006) before the handler runs — `INSERT … ON CONFLICT DO
// NOTHING`, so exactly one attempt wins and no attempt ever reaches the insert
// race (review finding 5: the loser used to throw through app.onError and be
// reported to GlitchTip as "unhandled" on a request that succeeded). What a
// later attempt with the same key is told, from the claim:
//   · the body hashes differently  → 422 idempotency_key_reused (finding 6a);
//   · 'done' and the row is there  → 200 with the row as it is NOW (6c: a
//     replay is not the original response, and skips validation — its body
//     was validated when the claim was made);
//   · 'done' and the row is gone   → 410 idempotent_create_gone: the tombstone,
//     so a late replay never re-creates a deleted row (6b);
//   · 'pending'                    → 409 idempotency_in_progress, a retry later —
//     unless the claim is older than PENDING_CLAIM_TTL_MS: then it was
//     abandoned, and is marked done (its row exists) or taken over;
//     ⚠️ one narrow gap, stated: a claim whose row was committed, then PURGED
//     (not soft-deleted — that answers 410), before the claim was finalised and
//     before the TTL passed, is taken over and the row created again. It needs
//     a crash between the insert and the final UPDATE plus a purge within the
//     same 10 minutes; the client waits out a 409 until then (Retry-After);
//   · the row soft-deleted         → 410 as well (the route's lookup says so).
// A claim whose handler did not create the row is released, so a retry can.
// A lost claim race is logged at INFO, never as an error.
//
// ⚠️ A KEY IS OPTIONAL. A request without one behaves exactly as before (a
// fresh `uuid()`), so an old client keeps working through the deploy. A key
// that is present but malformed is a 400 — a client that meant to be safe and
// is not should hear about it, not be quietly downgraded.
//
// ⚠️ PATCH IS IDEMPOTENT BY CONSTRUCTION and takes no key here: it SETS the
// fields it names, so a replay writes the same values again. The header is on
// the shared CORS allow-list so a browser may send it on any write.
//
// 🔴 THE SECOND KEYED CREATE: POST /v1/subscriptions/:id/payments (deferred
// item D-PAYMENTS-IDEMPOTENCY from the #1089 review). A manual payment is
// MONEY: a "mark as paid" whose response was lost, retried, recorded the
// amount twice and doubled the user's spend. It takes the same key, the same
// ledger and every answer above, through a SCOPE (`PAYMENT_SCOPE` below):
//   · ONE LEDGER, ONE KEY PER REQUEST. A key names one write of one user, on
//     whichever route it was first sent: the same key on the other route, or on
//     a payment for ANOTHER subscription, is 422 idempotency_key_reused — never
//     a replay of a row the second request did not ask for. A scope's hash
//     covers its name and its target (the path's subscription id) as well as
//     the body; the create's hash stays the body's alone, so every claim
//     already in the ledger answers exactly as it did. `row_id` then holds the
//     PAYMENT the key made (0006's comment predates the scope).
//   · ITS OWN ID NAMESPACE: the payment id is SHA-256("subscriptiontracker/
//     payment", user id, key), so one key never maps to the same id in both
//     tables.
// ─────────────────────────────────────────────────────────────────────────────
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { firstRow, nowIso, run } from './d1';
import { jsonBody } from './json-body';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * The same key as a QUERY PARAMETER — what the app sends (pre-merge E2E on
 * #1075). A new request header must be on a server's CORS allow-list before a
 * browser will send it, so a client that sent only the header failed every web
 * add against a Worker deployed before it. The query parameter needs nothing
 * from CORS: an older Worker ignores it (a plain create), this one reads it.
 * The header stays accepted for non-browser clients.
 */
export const IDEMPOTENCY_PARAM = 'idempotency_key';

/** A key is 8-128 URL-safe characters: a UUID fits, and so does a ULID. */
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** The id a keyed create reserves, per request. */
const reserved = new WeakMap<Request, string>();

/**
 * Which keyed create a claim belongs to (see the header). [name] namespaces the
 * derived id; [target] is what the request names besides its body, so one key
 * sent to two targets is a reuse, not a replay.
 */
export interface IdempotentScope {
  name: string;
  target?: (c: Context<AppEnv>) => string;
}

/** POST /v1/subscriptions: the scope every claim before the second one is in. */
export const CREATE_SCOPE: IdempotentScope = { name: 'create' };

/** POST /v1/subscriptions/:id/payments: a manual payment, for that subscription. */
export const PAYMENT_SCOPE: IdempotentScope = {
  name: 'payment',
  target: (c) => c.req.param('id') ?? '',
};

/** The row id [key] maps to for [userId] — stable, and private to the user. */
export async function idempotentRowId(
  userId: string,
  key: string,
  scope: IdempotentScope = CREATE_SCOPE,
): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`subscriptiontracker/${scope.name}\n${userId}\n${key}`),
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

/** JSON with object keys sorted, so a re-serialised body hashes the same. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What a claim's `body_hash` is for this request. The create's is the body's
 * alone, unchanged, so a claim already in the ledger still matches its
 * retries. Any other scope's is prefixed by its name and target: canonical JSON
 * never starts with a bare name, so no body of one route hashes like another's.
 */
function requestHash(c: Context<AppEnv>, scope: IdempotentScope, body: unknown): Promise<string> {
  // 🔴 BY NAME, NOT BY OBJECT IDENTITY (review of #1121, nit 1). `scope ===
  // CREATE_SCOPE` sent an equal literal `{ name: 'create' }` down the prefixed
  // branch, so a route mounted with one would hash every create differently and
  // production's existing claims would answer 422 to their own retries. The
  // name is what namespaces the derived id too (`idempotentRowId`), so it is the
  // one thing that may decide the hash.
  if (scope.name === CREATE_SCOPE.name) return sha256Hex(canonical(body));
  return sha256Hex(`${scope.name}\n${scope.target?.(c) ?? ''}\n${canonical(body)}`);
}

interface Claim {
  body_hash: string;
  row_id: string;
  state: 'pending' | 'done';
  created_at: string;
}

/**
 * How long a `pending` claim may stand before it is ABANDONED (review #1075
 * round 2, minor c). A claim is finalised after the handler; an isolate that
 * dies in between, or a final write that fails, left the key answering 409
 * forever. Ten minutes is far past any Worker's wall-time limit.
 */
// @ceiling none — the age after which an unfinished claim is abandoned, not a platform resource
export const PENDING_CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * Middleware in front of a create handler: claims the key, answers a repeat
 * from the claim and [existing], and reserves the derived id for the handler.
 * See the header for every answer, and for [scope].
 */
export function idempotentCreate(
  existing: (c: Context<AppEnv>, id: string) => Promise<Response | null>,
  scope: IdempotentScope = CREATE_SCOPE,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_HEADER) ?? c.req.query(IDEMPOTENCY_PARAM);
    if (key === undefined) return next();
    if (!KEY_RE.test(key)) {
      return c.json(
        { error: 'invalid_idempotency_key', detail: 'Idempotency-Key must be 8-128 of A-Z a-z 0-9 _ -' },
        400,
      );
    }
    // Read through lib/json-body.ts: the route's `boundedJson` already read the body
    // under its cap and answered a malformed one (invalid_json, nothing
    // claimed), so this hashes exactly the value the handler will validate.
    const body = jsonBody(c);
    const userId = c.get('userId');
    const db = c.env.APP_DB;
    const bodyHash = await requestHash(c, scope, body);
    const id = await idempotentRowId(userId, key, scope);

    const answer = async (claim: Claim): Promise<Response> => {
      if (claim.body_hash !== bodyHash) {
        return c.json(
          {
            error: 'idempotency_key_reused',
            detail: 'this Idempotency-Key was used with a different request body',
          },
          422,
        );
      }
      if (claim.state === 'pending') {
        c.header('Retry-After', '2');
        return c.json({ error: 'idempotency_in_progress' }, 409);
      }
      return (await existing(c, claim.row_id)) ?? c.json({ error: 'idempotent_create_gone' }, 410);
    };
    const lookup = () =>
      firstRow<Claim>(
        db
          .prepare('SELECT body_hash, row_id, state, created_at FROM idempotency_keys WHERE user_id = ? AND key = ?')
          .bind(userId, key),
      );

    const prior = await lookup();
    const abandoned =
      prior?.state === 'pending' &&
      prior.body_hash === bodyHash &&
      Date.parse(prior.created_at) < Date.now() - PENDING_CLAIM_TTL_MS;
    if (prior && !abandoned) return answer(prior);
    if (prior && abandoned) {
      // The claiming request never finished. If its row is there, the claim is
      // done after all; if not, this attempt takes the claim over — atomically,
      // so two late retries cannot both do it.
      const made = await existing(c, prior.row_id);
      if (made) {
        await run(
          db.prepare("UPDATE idempotency_keys SET state = 'done' WHERE user_id = ? AND key = ?").bind(userId, key),
        );
        return made;
      }
      const taken = await run(
        db
          .prepare(
            `UPDATE idempotency_keys SET created_at = ?
               WHERE user_id = ? AND key = ? AND state = 'pending' AND created_at = ?`,
          )
          .bind(nowIso(), userId, key, prior.created_at),
      );
      if ((taken.meta?.changes ?? 0) === 0) {
        c.header('Retry-After', '2');
        return c.json({ error: 'idempotency_in_progress' }, 409);
      }
      console.info(`[idempotency] took over an abandoned claim rid=${c.get('requestId') ?? '-'}`);
      return finish(id);
    }

    const claimed = await run(
      db
        .prepare(
          `INSERT INTO idempotency_keys (user_id, key, body_hash, row_id, state, created_at)
             VALUES (?, ?, ?, ?, 'pending', ?)
             ON CONFLICT (user_id, key) DO NOTHING`,
        )
        .bind(userId, key, bodyHash, id, nowIso()),
    );
    if ((claimed.meta?.changes ?? 0) === 0) {
      // A concurrent attempt claimed the key between our read and our insert.
      console.info(`[idempotency] lost the claim race rid=${c.get('requestId') ?? '-'}`);
      const winner = await lookup();
      return winner ? answer(winner) : c.json({ error: 'idempotency_in_progress' }, 409);
    }

    return finish(id);

    // Run the create under the claim, then settle the claim: done, or released
    // so a retry can create.
    async function finish(rowId: string): Promise<void> {
      reserved.set(c.req.raw, rowId);
      await next();
      const created = !c.error && c.res.status >= 200 && c.res.status < 300;
      await run(
        created
          ? db.prepare("UPDATE idempotency_keys SET state = 'done' WHERE user_id = ? AND key = ?").bind(userId, key)
          : db.prepare('DELETE FROM idempotency_keys WHERE user_id = ? AND key = ?').bind(userId, key),
      );
    }
  };
}
