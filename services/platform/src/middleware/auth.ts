// ─────────────────────────────────────────────────────────────────────────────
// platformAuth — the ONE authentication boundary of the shared Worker.
//
// [pipeline B-3] "The shared server can verify an identity token at the edge and
// expose a user id."
//
// ── WHAT MOVED, AND WHAT DELIBERATELY DID NOT ────────────────────────────────
// The DECIDING is in `services/_shared/src/auth.ts` and is carried by every
// Worker: the ES256 pin (`verifyOptions`), the twice-corrected
// `isKeySetUnavailable` predicate, `JWKS_KV_KEY`, `JWKS_TTL_SECONDS`, `bearer`
// and `usableJwksDocument`. ⏱ 2026-10-01: the `jose` plumbing moved too, to
// `services/_shared/src/auth-middleware.ts` (services/_shared is a package that
// declares `jose` since then). What stays HERE is the `hono` binding of those
// decisions to this Worker's context, and what only this Worker sets.
// [ADR 067] decision 2.
//
// SWAP-PROVIDER NOTE: this is the only file in services/platform that knows we
// use Supabase. To move to another identity provider, rewrite the verification
// below to point at that provider's issuer + JWKS URL; every route just reads
// `c.get('userId')`. Keep this file the single seam.
//
// ── 🔴 WHY THERE IS NO HS256 FALLBACK, AND WHY THAT IS A DELIBERATE DIVERGENCE ─
// `services/subscriptiontracker-api/src/middleware/auth.ts` — the file this is ported from —
// falls back to verifying with a shared secret (`SUPABASE_JWT_SECRET`) when the
// asymmetric path fails. That fallback is NOT carried across, on purpose:
//
//   · This Worker is the shared server for the WHOLE portfolio. Its auth
//     boundary guards account deletion and (with stage 5) entitlements for every
//     app, including apps that do not exist yet. A symmetric secret accepted
//     there is one leaked environment variable away from anyone minting a token
//     for any user of any app.
//   · A fallback that triggers on ANY primary failure is a fallback that
//     triggers when Supabase is merely unreachable — so a network blip silently
//     downgrades the portfolio's only auth boundary from asymmetric to shared-
//     secret. That is the failure mode, not the recovery.
//   · The asymmetric path needs no secret at all: the JWKS is public. So the
//     fallback buys nothing here that is worth what it costs.
//
// A token signed with the legacy HS256 secret is therefore a 401, and that case
// is a recorded failing input in test/auth.test.ts rather than a claim.
//
// 📌 AND SINCE [ADR 067] THAT IS A PROPERTY OF THIS FILE'S IMPORTS, NOT ONLY OF
// ITS BODY. `services/_shared/src/auth.ts` names no secret, neither does
// `services/_shared/src/auth-middleware.ts` (its HS256 branch takes a secret VALUE
// a carrier passes, and this file passes `NO_SYMMETRIC_FALLBACK`), and neither
// does `../lib/ext-links` (⏱ 2026-09-30, EXA-11 — D1 statements only, no env
// read), so "nothing reachable from here can read SUPABASE_JWT_SECRET" is
// checkable by reading five import lines. `tooling/ci/assert-erasure-reach.mjs` limb 3 walks
// exactly that.
//
// ── THE CACHE, AND THE ROTATION IT MUST SURVIVE ──────────────────────────────
// ⚠️ The project has exactly ONE ES256 key today, which means a stale JWKS cache
// is invisible until the day it rotates — and on that day every authenticated
// request across every app fails at once. So the cache is TTL'd *and*
// refresh-on-unknown-kid: `createRemoteJWKSet` refetches when it sees a `kid` it
// does not hold, and the KV copy is the warm-start for a cold isolate rather
// than the source of truth. The two together mean a rotation costs one extra
// fetch, not an outage.
//
// The KV write is gated on the cached copy being ABSENT rather than issued on
// every miss: KV Free allows 1,000 writes/day account-wide
// (`tooling/ceilings.json` → `kv.writesPerDay`), shared with CONFIG_KV, and a
// cache that re-put on every cold isolate would spend that budget on itself.
// (Both halves now live in `warmJwksCache` / `remoteJwks` in the kit.)
// ─────────────────────────────────────────────────────────────────────────────

import type { MiddlewareHandler } from 'hono';
import { authRecencyOf, bearer } from '../../../_shared/src/auth';
import { NO_SYMMETRIC_FALLBACK, sessionRevoked, verifySupabaseToken } from '../../../_shared/src/auth-middleware';
import type { AppEnv } from '../types';
import { raiseLinkFloor } from '../lib/ext-links';

// ⏱ 2026-10-01 · rv2 SYN-S2 (services-012). The
// PLUMBING — the remote JWKS getter cached per SUPABASE_URL, the KV warm-start
// (`warmCache` here, `warmJwksCache` in the app Workers: aligned on the explicit
// absent-binding check this file had), the cached-key-set second attempt that
// #433 added HERE first and the revocation read — moved WHOLE to
// services/_shared/src/auth-middleware.ts, which this file calls. Each carrier
// had its own copy and nothing compared them; the headers there hold the
// reasoning that used to live here (the outage that failed closed, why the cache
// helpers take one binding and never `Env`, why the revocation read fails open).
// What stays here is what only this Worker does: the context it sets and the
// recovery floor below.
//
// 🔴 THE "NO HS256 FALLBACK" ABOVE IS NOW A DECLARED OPTION: `platformAuth`
// verifies through `verifySupabaseToken(…, NO_SYMMETRIC_FALLBACK)`, which carries
// no secret, and this Worker's Env has no SUPABASE_JWT_SECRET to pass.

// ⏱ 2026-09-16 · O-APP-API-DELETE-NO-RECENCY — `authRecencyOf` (how the verified
// token's user signs in, and when they last AUTHENTICATED — `amr`, never `iat`) moved
// VERBATIM to services/_shared/src/auth.ts, so every erasure door reads one
// implementation. Re-exported here so this Worker's callers and tests are unchanged.
export { authRecencyOf } from '../../../_shared/src/auth';

/**
 * ⏱ 2026-09-24 · O-GOOGLE-SIGN-IN-NOT-BUILT. The identity providers the VERIFIED
 * token says this account has linked: `app_metadata.providers`, the claim
 * `authRecencyOf` reads too. GoTrue writes `app_metadata` and a user cannot, so it
 * is the server's word, not the caller's. Strings only; an absent or malformed
 * claim is the empty list, which links nothing — so a route that cross-checks a
 * body against it refuses rather than guesses.
 */
export function linkedProvidersOf(payload: Record<string, unknown>): string[] {
  const meta = payload.app_metadata;
  const providers = meta && typeof meta === 'object' ? (meta as { providers?: unknown }).providers : undefined;
  return Array.isArray(providers) ? providers.filter((p): p is string => typeof p === 'string') : [];
}

/**
 * ⏱ 2026-09-30 · EXA-11. The instant (ms) GoTrue recorded a `recovery`
 * authentication on this token's session — the session a password-reset link
 * opens — or null. `amr[]` is GoTrue's own claim, signed with the token; the
 * newest recovery entry wins, and a non-numeric timestamp is no entry.
 */
export function recoveryAuthenticatedAt(payload: Record<string, unknown>): number | null {
  if (!Array.isArray(payload.amr)) return null;
  let at: number | null = null;
  for (const entry of payload.amr) {
    if (!entry || typeof entry !== 'object') continue;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (method === 'recovery' && typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      at = at === null ? timestamp * 1000 : Math.max(at, timestamp * 1000);
    }
  }
  return at;
}

/**
 * ⏱ 2026-09-30 · EXA-11 (re-review findings 1, 2, 4) — A RECOVERY SESSION RAISES
 * THE ACCOUNT'S EXTENSION-LINK FLOOR, ONCE.
 *
 * GoTrue performs the reset and revokes its own refresh tokens; it tells this
 * Worker nothing, and a linked extension's credential is not a GoTrue session.
 * What the Worker CAN see is the reset's session: a verified token whose `amr`
 * carries a `recovery` entry. The shape is GoTrue's own, read at source
 * (supabase/auth, 2026-09-30): internal/models/factor.go maps the `Recovery`
 * authentication method to the string "recovery"; internal/models/sessions.go
 * `AMREntry` is `{method, timestamp, provider?}` with `timestamp =
 * claim.UpdatedAt.Unix()` (seconds), newest first; internal/tokens/service.go
 * puts it in the access token as `amr`. test/ext-auth.test.ts drives a token of
 * exactly that claim set. ⚠️ PROVEN BY THAT UNIT TEST ONLY: no live recovery
 * flow has yet been measured reaching this Worker (E2E follow-up).
 *
 * The floor (lib/ext-links.ts) is raised to the server's now, so every link —
 * and every code — minted by a session that started before it is dead,
 * whenever it was minted. The owner's re-link after the reset comes from a
 * fresh sign-in and passes.
 *
 * 🔴 ONCE PER RECOVERY SESSION, NOT ONCE PER REQUEST. GoTrue keeps a session's
 * `amr` for its whole life, so every request of that session arrives here. The
 * write is keyed by the GoTrue `session_id` in D1 (`recovery_session`: a
 * second isolate's write changes nothing), and this isolate remembers the
 * sessions it has already written, so a repeat costs no D1 round trip at all.
 *
 * 🔴 BEST-EFFORT, BOUNDED, NEVER A REFUSAL. A D1 failure or a write slower than
 * RECOVERY_FLOOR_TIMEOUT_MS logs ONE line — the event and the error's name,
 * never an id or an email — and the request proceeds: this middleware guards
 * every JWT route, and an extension link is not what they authorise. A failed
 * write is not remembered, so the session's next request tries again.
 */
/**
 * How long the recovery door waits for its one D1 write before admitting the
 * request anyway.
 *
 * @ceiling none — a CLIENT-SIDE PATIENCE BUDGET on a best-effort write, not a platform resource, the same kind as sessions.ts `SESSIONS_RPC_TIMEOUT_MS`.
 */
export const RECOVERY_FLOOR_TIMEOUT_MS = 2_000;

/**
 * How many recovery sessions one isolate remembers having written.
 *
 * @ceiling none — an in-memory bound on a per-isolate cache, not a platform resource.
 */
const RECOVERY_MEMO_MAX = 1_000;
const recoveryWritten = new Set<string>();

async function raiseFloorOnRecovery(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  sub: string,
  payload: Record<string, unknown>,
  logPrefix: string,
) {
  const at = recoveryAuthenticatedAt(payload);
  if (at === null || !c.env.PLATFORM_DB) return;
  const session = typeof payload.session_id === 'string' && payload.session_id !== '' ? payload.session_id : `amr:${at}`;
  const key = `${sub}|${session}`;
  if (recoveryWritten.has(key)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      raiseLinkFloor(c.env.PLATFORM_DB, sub, new Date().toISOString(), session),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('RecoveryFloorTimeout')), RECOVERY_FLOOR_TIMEOUT_MS);
      }),
    ]);
    if (recoveryWritten.size >= RECOVERY_MEMO_MAX) recoveryWritten.clear();
    recoveryWritten.add(key);
  } catch (err) {
    console.warn(`${logPrefix} ext_link_floor_recovery_write_failed: ${err instanceof Error ? err.message === 'RecoveryFloorTimeout' ? 'timeout' : err.name : typeof err}; admitted`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * ⏱ 2026-09-30 · EXA-11 (review 2, finding 1). When the verified token's
 * SESSION STARTED, ISO: the OLDEST `amr` timestamp. routes/ext.ts stamps it on
 * every code it mints as `auth_at`, and the link floor is compared against it.
 *
 * 🔴 THE OLDEST, NEVER THE NEWEST. GoTrue appends an `amr` entry to an EXISTING
 * session whenever it steps up (a `totp` entry after an MFA verify), so the
 * newest timestamp moves past a reset's floor without anybody signing in again —
 * a session stolen before the reset could enrol TOTP and then link a browser.
 * The oldest entry is the session's start, which no step-up moves. (The
 * deletion-recency check keeps the NEWEST, `authRecencyOf`, on purpose: there
 * the question is "authenticated lately", here it is "began before the reset".)
 *
 * 🔴 NO `amr`, NO START — AND NO `iat` FALLBACK. Every silent refresh rewrites
 * `iat`, so it says nothing about when the session began. A token without a
 * numeric `amr` timestamp answers null, and a null `auth_at` is older than ANY
 * floor (lib/ext-links.ts `predatesFloor`): fail closed. GoTrue always sets
 * `amr` (internal/tokens/service.go), so this refuses only a token GoTrue did
 * not shape.
 */
export function sessionStartedAtOf(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.amr)) return null;
  let oldest: number | null = null;
  for (const entry of payload.amr) {
    const ts = entry && typeof entry === 'object' ? (entry as { timestamp?: unknown }).timestamp : undefined;
    if (typeof ts === 'number' && Number.isFinite(ts)) oldest = oldest === null ? ts : Math.min(oldest, ts);
  }
  if (oldest === null) return null;
  const d = new Date(oldest * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Hono middleware. On success sets `userId` (+ `userEmail` when the token
 * carries one, + `sessionId`) and calls next(). On ANY failure it answers 401 with
 * `{ error: 'unauthorized' }` and nothing else — the reason a token was refused
 * is a fact about our verification, not information a caller is owed.
 */
export const platformAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c.req.header('Authorization') ?? '');
  if (token === null) return c.json({ error: 'unauthorized' }, 401);

  try {
    const { payload } = await verifySupabaseToken(token, c.env.SUPABASE_URL, c.env.JWKS_CACHE, NO_SYMMETRIC_FALLBACK);
    // `sub` IS the user id. A verified token with no subject authenticates
    // nobody, and letting it through would set `userId` to undefined and hand
    // every `WHERE user_id = ?` a null — which matches no row on a read and, on
    // a DELETE, is the difference between deleting nothing and being asked to.
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    // ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS — a signed-out session's token is
    // refused here, with the same plain 401 as any other refusal.
    const logPrefix = `[auth] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID}`;
    if (await sessionRevoked(c.env.SESSION_REVOKED, payload.sub, payload as Record<string, unknown>, logPrefix)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await raiseFloorOnRecovery(c, payload.sub, payload as Record<string, unknown>, logPrefix);
    c.set('userId', payload.sub);
    // The session this token belongs to — GoTrue's `session_id` claim, absent on
    // a token that carries none. /v1/sessions uses it to mark "this device" and to
    // refuse revoking the caller's own session as if it were another's.
    c.set('sessionId', typeof payload.session_id === 'string' ? payload.session_id : undefined);
    const email = (payload as { email?: unknown }).email;
    if (typeof email === 'string') c.set('userEmail', email);
    c.set('authRecency', authRecencyOf(payload as Record<string, unknown>));
    c.set('sessionStartedAt', sessionStartedAtOf(payload as Record<string, unknown>) ?? undefined);
    c.set('linkedProviders', linkedProvidersOf(payload as Record<string, unknown>));
    await next();
    return;
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
};
