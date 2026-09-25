// ─────────────────────────────────────────────────────────────────────────────
// sessions.ts — the signed-in sessions of the caller's account, and signing them
// out AT THE WORKERS, not only at the next refresh.
//
// ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS. Deleting a row in `auth.sessions` stops
// that session's NEXT refresh and does nothing to the access token it already
// holds: every Worker admits that token on its signature alone until its `exp`,
// up to an hour later. So a sign-out here does two things — Supabase forgets the
// session (the RPC), and the session id is written to the revocation list
// (SESSION_REVOKED, `rev:<sub>`) that every auth middleware reads after
// `jwtVerify`. The decision is `revocationRefusal` in services/_shared/src/auth.ts.
//
//   GET    /v1/sessions               the account's sessions, the caller's marked
//   DELETE /v1/sessions/:id           sign ONE other session out
//   POST   /v1/sessions/revoke-all    refuse every token issued before now
//   POST   /v1/sessions/revoke-others list every session but the caller's
//
// 🔴 THIS FILE IS THE ONLY WRITER OF SESSION_REVOKED, and every put carries
// `expirationTtl` after pruning (tooling/ops/register.json
// retention.kv.platform.SESSION_REVOKED; tooling/ci/assert-session-revocation.mjs
// holds the period). ⚠️ LAST WRITER WINS: two sign-outs for one account in the
// same instant can each read the record, and the later put drops the earlier
// one's entry. Accepted — SESSIONS_LIMITER bounds it to a person acting against
// themself, and the RPC has already deleted the session, so the lost entry
// re-admits at most that session's current token, never a refresh.
//
// The two RPCs live in docs/platform/supabase/sql/sessions-rpc.sql and are
// applied by hand. Until they are, every route that needs one answers 503
// `sessions_unavailable` — never a guess, never an empty list.
//
// Mounted behind `platformAuth` by the `/v1/sessions` and `/v1/sessions/*` lines
// in index.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { REVOCATION_TTL_SECONDS, revocationKey, withRevokedBefore, withRevokedSessions } from '../../../_shared/src/auth';
import { withinRateLimit } from '../lib/edge-ceiling';

const sessions = new Hono<AppEnv>();

/**
 * How long one PostgREST RPC may take before the route gives up on it.
 *
 * @ceiling none — a CLIENT-SIDE PATIENCE BUDGET on an outbound call, not a
 * platform resource, the same kind as provider-revoke.ts
 * `PROVIDER_REVOKE_TIMEOUT_MS`. A database that accepts the connection and never
 * answers would otherwise hold the request open; a timeout is a 503.
 */
export const SESSIONS_RPC_TIMEOUT_MS = 8_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A session as the client sees it. No IP address, ever. */
export interface SessionView {
  id: string;
  current: boolean;
  createdAt: string | null;
  lastActiveAt: string | null;
  device: string;
}

/**
 * A short, human label for a User-Agent: "Chrome on Windows", "Safari on
 * iPhone". Pure; the order of the tests is the whole logic (Edge and Opera
 * carry "Chrome/", every iOS browser carries "Safari/").
 */
export function deviceLabel(ua: unknown): string {
  if (typeof ua !== 'string' || ua.trim() === '') return 'Unknown device';
  const browser =
    /\bEdg(?:e|A|iOS)?\//.test(ua) ? 'Edge'
    : /\bOPR\/|\bOpera\b/.test(ua) ? 'Opera'
    : /\bSamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /\bFirefox\/|\bFxiOS\//.test(ua) ? 'Firefox'
    : /\bChrome\/|\bCriOS\/|\bChromium\//.test(ua) ? 'Chrome'
    : /\bVersion\/[\d.]+.*\bSafari\//.test(ua) ? 'Safari'
    : null;
  const os =
    /\biPhone\b/.test(ua) ? 'iPhone'
    : /\biPad\b/.test(ua) ? 'iPad'
    : /\bAndroid\b/.test(ua) ? 'Android'
    : /\bCrOS\b/.test(ua) ? 'ChromeOS'
    : /\bWindows\b/.test(ua) ? 'Windows'
    : /\bMac OS X\b|\bMacintosh\b/.test(ua) ? 'macOS'
    : /\bLinux\b/.test(ua) ? 'Linux'
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

/**
 * An ISO-8601 UTC string, or null. `auth.sessions.refreshed_at` is a timestamp
 * WITHOUT time zone, so PostgREST sends it with no offset; GoTrue writes UTC, and
 * a value with no offset is read as UTC rather than as the Worker's local time.
 */
export function isoUtc(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const v = value.trim().replace(' ', 'T');
  const zoned = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(v) ? v : `${v}Z`;
  const t = Date.parse(zoned);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

type Rpc = { ok: true; rows: unknown[] } | { ok: false; why: string };

/**
 * One PostgREST RPC with the service-role key. The key is read here, in the route
 * module, and nowhere below it; it is never echoed. Any failure — no key, the
 * function not installed (404 / PGRST202), a non-2xx, a timeout, a body that is
 * not an array — is a `why` for ONE log line and a 503 to the caller.
 */
async function rpc(c: Context<AppEnv>, fn: string, args: Record<string, string>): Promise<Rpc> {
  const serviceRoleKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return { ok: false, why: 'SUPABASE_SERVICE_ROLE_KEY is not set' };
  let res: Response;
  try {
    res = await fetch(`${c.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(SESSIONS_RPC_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, why: `${fn} unreachable (${err instanceof Error ? err.name : typeof err})` };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const missing = res.status === 404 || text.includes('PGRST202');
    return {
      ok: false,
      why: missing
        ? `${fn} is not installed — apply docs/platform/supabase/sql/sessions-rpc.sql`
        : `${fn} answered ${res.status}`,
    };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, why: `${fn} answered a body that is not JSON` };
  }
  if (!Array.isArray(body)) return { ok: false, why: `${fn} answered a body that is not an array` };
  return { ok: true, rows: body };
}

const rowId = (row: unknown): string | null => {
  const id = row && typeof row === 'object' ? (row as Record<string, unknown>).id : null;
  return typeof id === 'string' && UUID_RE.test(id) ? id.toLowerCase() : null;
};

/**
 * Read `rev:<sub>`, apply `next`, put it back with the record's TTL. Throws on any
 * KV failure — each caller decides what a failed write means for its route.
 */
async function writeRevocation(
  kv: KVNamespace | undefined,
  sub: string,
  next: (record: unknown, nowSeconds: number) => unknown,
): Promise<void> {
  if (!kv) throw new Error('SESSION_REVOKED is not bound');
  const key = revocationKey(sub);
  const current: unknown = await kv.get(key, 'json');
  const record = next(current, Math.floor(Date.now() / 1000));
  await kv.put(key, JSON.stringify(record), { expirationTtl: REVOCATION_TTL_SECONDS });
}

const logPrefix = (c: Context<AppEnv>) => `[sessions] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID}`;
const errName = (err: unknown) => (err instanceof Error ? err.name : typeof err);

/** SESSIONS_LIMITER, keyed on the VERIFIED subject. Fails open (withinRateLimit). */
async function limited(c: Context<AppEnv>): Promise<boolean> {
  return !(await withinRateLimit(c.env.SESSIONS_LIMITER, `sessions:${c.get('userId')}`, 'SESSIONS_LIMITER'));
}

const unavailable = (c: Context<AppEnv>, why: string) => {
  console.error(`${logPrefix(c)} sessions_unavailable: ${why}`);
  return c.json({ error: 'sessions_unavailable' }, 503);
};

sessions.get('/sessions', async (c) => {
  if (await limited(c)) return c.json({ error: 'rate_limited' }, 429);
  const userId = c.get('userId');
  const current = c.get('sessionId')?.toLowerCase();
  const got = await rpc(c, 'nikatru_sessions_of', { p_user: userId });
  if (!got.ok) return unavailable(c, got.why);
  const list: SessionView[] = [];
  for (const row of got.rows) {
    const id = rowId(row);
    if (!id) continue;
    const r = row as Record<string, unknown>;
    const createdAt = isoUtc(r.created_at);
    list.push({
      id,
      current: id === current,
      createdAt,
      lastActiveAt: isoUtc(r.refreshed_at) ?? createdAt,
      device: deviceLabel(r.user_agent),
    });
  }
  list.sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''));
  return c.json({ sessions: list }, 200);
});

sessions.delete('/sessions/:id', async (c) => {
  if (await limited(c)) return c.json({ error: 'rate_limited' }, 429);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404);
  const target = id.toLowerCase();
  // The caller's OWN session is signed out by the client (supabase signOut), which
  // also clears its local tokens; refused here so a list-and-tap cannot strand a
  // device holding a token the server no longer honours but the app still uses.
  if (target === c.get('sessionId')?.toLowerCase()) return c.json({ error: 'current_session' }, 409);
  const userId = c.get('userId');
  const got = await rpc(c, 'nikatru_revoke_session', { p_user: userId, p_session: target });
  if (!got.ok) return unavailable(c, got.why);
  // The RPC deletes only WHERE id = p_session AND user_id = p_user, so another
  // account's session id is indistinguishable from one that never existed.
  if (!got.rows.some((row) => rowId(row) === target)) return c.json({ error: 'not_found' }, 404);
  const add = (record: unknown, now: number) => withRevokedSessions(record, [target], now);
  try {
    await writeRevocation(c.env.SESSION_REVOKED, userId, add);
  } catch {
    try {
      await writeRevocation(c.env.SESSION_REVOKED, userId, add);
    } catch (err) {
      // The session IS gone from Supabase, so it can never refresh; what is lost is
      // refusing its CURRENT access token for the rest of that token's hour.
      console.error(`${logPrefix(c)} revocation_write_failed after retry (${errName(err)}); the session is deleted, its current token is not refused`);
    }
  }
  return c.body(null, 204);
});

sessions.post('/sessions/revoke-all', async (c) => {
  if (await limited(c)) return c.json({ error: 'rate_limited' }, 429);
  try {
    await writeRevocation(c.env.SESSION_REVOKED, c.get('userId'), withRevokedBefore);
  } catch (err) {
    console.error(`${logPrefix(c)} revocation_unavailable: revoke-all could not be written (${errName(err)})`);
    return c.json({ error: 'revocation_unavailable' }, 503);
  }
  return c.body(null, 204);
});

sessions.post('/sessions/revoke-others', async (c) => {
  if (await limited(c)) return c.json({ error: 'rate_limited' }, 429);
  const current = c.get('sessionId')?.toLowerCase();
  // With no session id on the token there is no way to spare the caller's own
  // session; revoking "all but unknown" would sign the caller out too.
  if (!current) return c.json({ error: 'current_session_unknown' }, 409);
  const userId = c.get('userId');
  const got = await rpc(c, 'nikatru_sessions_of', { p_user: userId });
  if (!got.ok) return unavailable(c, got.why);
  const others = got.rows.map(rowId).filter((id): id is string => id !== null && id !== current);
  if (others.length === 0) return c.body(null, 204);
  try {
    await writeRevocation(c.env.SESSION_REVOKED, userId, (record, now) => withRevokedSessions(record, others, now));
  } catch (err) {
    console.error(`${logPrefix(c)} revocation_unavailable: revoke-others could not be written (${errName(err)})`);
    return c.json({ error: 'revocation_unavailable' }, 503);
  }
  return c.body(null, 204);
});

export default sessions;
