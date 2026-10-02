// ─────────────────────────────────────────────────────────────────────────────
// auth-middleware.ts — THE ONE HOME OF THE AUTH PLUMBING: the `jose` half of
// verifying a Supabase token at the edge, and the two app-Worker boundaries.
//
// [pipeline B-3] "The shared server can verify an identity token at the edge and
// expose a user id." auth.ts beside this file holds the DECIDING (the ES256 pin,
// `isKeySetUnavailable`, the KV key and TTL, the bearer parse, the empty-JWKS
// refusal, recency and revocation); this file holds what wires those decisions
// to a request — and until 2026-10-01 it was THREE HAND COPIES.
//
// ── ⏱ 2026-10-01 · rv2 SYN-S2 (services-012) ─
// services/subscriptiontracker-api/src/middleware/auth.ts, the brick's Worker
// template's and services/platform's each carried the remote-JWKS getter, the
// KV warm, the cached-key-set fallback and the revocation read. The two app
// copies were the same code under different comments; platform's was the same
// plumbing inlined. Drift had already happened twice — #433 reached platform and
// not the app Worker, and `warmJwksCache` checked for an absent JWKS_CACHE in
// one copy only — and nothing compared them: the twin test reads `src/lib`, and
// these lived in `src/middleware`. They moved here WHOLE, unchanged in what they
// accept and refuse; each carrier's `middleware/auth.ts` now re-exports this file
// and BINDS it. A behaviour change is not part of the move.
//
// ── WHY THIS FILE MAY IMPORT `jose` WHEN NOTHING ELSE HERE MAY ───────────────
// services/_shared is a package (package.json, `@nikatru/worker-kit`) that
// declares `jose`, installed into services/_shared/node_modules by
// `npm ci --prefix ../_shared` — each Worker's `postinstall`, because npm does
// not install a `file:` dependency's own dependencies (measured 2026-10-01 on
// npm 10: the link is made, its `jose` is not). So `jose` now resolves from here
// the way it resolves from a Worker: by walking up, through the package's own
// `exports` conditions — the `workerd` build at the edge and in each Worker's
// vitest, never a wrangler `alias` to a directory, which is how that build was
// lost once. shared-home.test.ts holds the rule: a bare import is allowed only
// to a module that is listed as needing one, and only of a package
// package.json declares. `hono` is NOT one of them: the middleware below is
// typed by the members of the context it touches, as cors.ts is.
//
// ── 🔴 THIS FILE NAMES NO SECRET, AND THE DIFFERENCE BETWEEN CARRIERS IS AN
//      OPTION A CARRIER PASSES, NOT A COPY IT KEEPS ──────────────────────────
// The legacy HS256 fallback is reached only through
// `supabaseAuthWith({ legacyHs256Secret })`, and the secret arrives as a VALUE
// the carrier's own binding reads from its own environment. So:
//   · services/platform binds no fallback at all — its `platformAuth` verifies
//     through `verifySupabaseToken(…, NO_SYMMETRIC_FALLBACK)`, and its Env has
//     no SUPABASE_JWT_SECRET to pass;
//   · `erasureAuth` and `verifyAsymmetric` take no environment and no secret, so
//     "the erasure boundary cannot fall back to a shared secret" is still a
//     property of a SIGNATURE, checkable by reading four lines;
//   · `tooling/ci/assert-erasure-reach.mjs` limb 3 still finds which middleware
//     can reach SUPABASE_JWT_SECRET in each carrier's `middleware/auth.ts`,
//     because that file is where the secret is named.
// ─────────────────────────────────────────────────────────────────────────────

import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import {
  JWKS_KV_KEY,
  JWKS_TTL_SECONDS,
  authRecencyOf,
  bearer,
  isKeySetUnavailable,
  revocationKey,
  revocationRefusal,
  usableJwksDocument,
  verifyOptions,
  type AuthRecency,
} from './auth';

/** How a token was verified. 'symmetric' exists ONLY on an app Worker's
 *  permissive boundary bound with a legacy secret, and every erasure route
 *  refuses it. */
export type TokenAssurance = 'asymmetric' | 'symmetric';

/** The remote JWKS *getter*, cached per SUPABASE_URL for the isolate's life.
 *  `createRemoteJWKSet` keeps its own in-memory cache with request coalescing
 *  and refetches on an unknown `kid` — which is the half that survives a key
 *  rotation. Rebuilding it per request would throw that away and turn every
 *  verify into a fetch. The KV copy is the warm-start for a cold isolate rather
 *  than the source of truth; the two together mean a rotation costs one extra
 *  fetch, not an outage. */
const remoteSets = new Map<string, JWTVerifyGetKey>();

export function remoteJwks(supabaseUrl: string): JWTVerifyGetKey {
  let set = remoteSets.get(supabaseUrl);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    remoteSets.set(supabaseUrl, set);
  }
  return set;
}

/**
 * Best-effort warm of the KV copy. Never awaited on the request path and never
 * fatal: `jose` does its own fetching, so a KV failure costs latency on a cold
 * isolate and nothing else.
 *
 * ⏱ 2026-10-01 · ALIGNED. platform's copy returned early on an absent
 * JWKS_CACHE; the app Workers' copies reached `env.JWKS_CACHE.get` and let the
 * TypeError fall into the catch. Same outcome — no fetch, no write — so the
 * explicit check is kept. It takes the two values it needs, not `Env`, the
 * `localSetFromCache` rule: nothing on the erasure boundary is handed the
 * environment that holds SUPABASE_JWT_SECRET.
 *
 * The write is gated on the cached copy being ABSENT rather than issued on every
 * miss: KV Free allows 1,000 writes/day account-wide (`tooling/ceilings.json` →
 * `kv.writesPerDay`), and a cache that re-put on every cold isolate would spend
 * that budget on itself.
 */
export async function warmJwksCache(supabaseUrl: string, jwksCache: KVNamespace | undefined): Promise<void> {
  try {
    if (!jwksCache) return;
    if (await jwksCache.get(JWKS_KV_KEY)) return; // still warm
    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) return;
    await jwksCache.put(JWKS_KV_KEY, await res.text(), {
      expirationTtl: JWKS_TTL_SECONDS,
    });
  } catch {
    // Non-fatal by construction: verification still works via jose's own fetch.
  }
}

/**
 * The KV-cached key set, or null — the second attempt when, and ONLY when, the
 * key set could not be fetched at all.
 *
 * 🔴 THE JWKS USED TO FAIL CLOSED, IN EVERY CARRIER. Read from jose's own source
 * (`src/jwks/remote.ts`): `createRemoteJWKSet` keeps a per-isolate in-memory
 * cache, and **on a failed fetch the error propagates — there is no fallback to
 * a previously cached key set.** Isolates are almost always cold here, so an
 * unreachable JWKS endpoint 401'd every authenticated request on platform (#433)
 * and, on an app Worker, SILENTLY DOWNGRADED every request to the HS256 shared
 * secret when one was configured (#435) — while the KV copy `warmJwksCache`
 * writes sat unread.
 *
 * ⚠️ IT TAKES THE ONE BINDING IT NEEDS, NOT `Env`. A function that never
 * receives the environment cannot read `SUPABASE_JWT_SECRET`. The cached JWKS is
 * a PUBLIC document, so caching it adds no secret to this scope. The parse and
 * the empty-key-set refusal are `usableJwksDocument` in auth.ts; only the
 * key-set construction, which needs `jose`, is here.
 */
export async function localSetFromCache(jwksCache: KVNamespace | undefined): Promise<JWTVerifyGetKey | null> {
  try {
    if (!jwksCache) return null;
    const doc = usableJwksDocument(await jwksCache.get(JWKS_KV_KEY));
    if (doc === null) return null;
    return createLocalJWKSet(doc as Parameters<typeof createLocalJWKSet>[0]);
  } catch {
    // A corrupt cache, or a KV read that threw, is no cache. Fail closed.
    return null;
  }
}

/**
 * THE ASYMMETRIC PATH, ON ITS OWN, WITH NO SECRET IN SCOPE.
 *
 * 🔴 It takes `SUPABASE_URL` and the cache binding rather than `Env` ON PURPOSE.
 * A function that never receives the environment cannot read
 * `SUPABASE_JWT_SECRET`, so "this path cannot fall back to a shared secret" is a
 * property of the SIGNATURE — checkable by reading four lines — rather than a
 * claim about the body that a later edit could quietly falsify.
 */
export async function verifyAsymmetric(token: string, supabaseUrl: string, jwksCache?: KVNamespace): Promise<JWTPayload> {
  const opts = verifyOptions(supabaseUrl);
  try {
    const { payload } = await jwtVerify(token, remoteJwks(supabaseUrl), opts);
    return payload;
  } catch (err) {
    // ⚠️ ONLY a key-set acquisition failure earns a second attempt, and it is
    // verified against the SAME `opts` object — one declaration, both paths, so
    // the two cannot drift into a weaker one an attacker reaches by making the
    // JWKS endpoint unreachable. A bad token still fails here and now.
    if (!isKeySetUnavailable(err)) throw err;
    const local = await localSetFromCache(jwksCache);
    // No usable cache ⇒ behave exactly as before: rethrow, fail closed.
    if (!local) throw err;
    const { payload } = await jwtVerify(token, local, opts);
    return payload;
  }
}

/** THE DECLARED DIFFERENCE BETWEEN CARRIERS. The secret is a VALUE the carrier
 *  read from its own environment, never an environment handed in here. */
export interface SymmetricFallback {
  /** The legacy HS256 shared secret, or undefined for none. */
  readonly legacyHs256Secret: string | undefined;
}

/** services/platform's binding, and any boundary that must never accept a
 *  shared secret: there is none to fall back to. */
export const NO_SYMMETRIC_FALLBACK: SymmetricFallback = Object.freeze({ legacyHs256Secret: undefined });

/**
 * PRIMARY asymmetric (ES256 via JWKS, with the KV-cached key set as the second
 * attempt); FALLBACK legacy HS256 only when `fallback` carries a secret, with
 * the issuer, audience and algorithm still enforced so a token from any OTHER
 * Supabase project fails. The asymmetric path survives a mere JWKS outage, so
 * the HS256 branch is not reached by unreachability alone.
 *
 * ⚠️ `assurance` IS THE POINT OF THE RETURN: 'symmetric' is what the erasure
 * route refuses.
 */
export async function verifySupabaseToken(
  token: string,
  supabaseUrl: string,
  jwksCache: KVNamespace | undefined,
  fallback: SymmetricFallback,
): Promise<{ payload: JWTPayload; assurance: TokenAssurance }> {
  try {
    // Fire-and-forget KV warm; verification does not block on it.
    void warmJwksCache(supabaseUrl, jwksCache);
    return { payload: await verifyAsymmetric(token, supabaseUrl, jwksCache), assurance: 'asymmetric' };
  } catch (primaryErr) {
    const secret = fallback.legacyHs256Secret;
    if (secret) {
      const key = new TextEncoder().encode(secret);
      const { payload } = await jwtVerify(token, key, {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: 'authenticated',
        algorithms: ['HS256'],
      });
      return { payload, assurance: 'symmetric' };
    }
    throw primaryErr;
  }
}

/**
 * ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS. True when the VERIFIED token belongs to
 * a session that was signed out — its `session_id` is listed in the user's
 * `rev:<sub>` record, or it was issued before that record's `before`. The
 * decision is `revocationRefusal` in auth.ts; only the KV read and the fail-open
 * policy are here. No `cacheTtl`: a cached miss would keep admitting a revoked
 * token for as long as the cache lived.
 *
 * 🔴 IT FAILS OPEN, ON PURPOSE. A read that throws (a KV incident, or a record
 * that is not JSON) and a missing binding both ADMIT, with one log line naming
 * the event and nothing else — never the token, the user id or a session id.
 * The worst case of admitting is the behaviour before the list existed (a
 * signed-out session's access token lives until its own `exp`); failing closed
 * would turn a KV incident into a portfolio-wide 401, which every client reads
 * as a dead session. A binding missing from a Worker's config is a CI red
 * instead (tooling/ci/assert-session-revocation.mjs), not a runtime refusal.
 *
 * Takes the ONE binding it needs, not `Env` — the `localSetFromCache` rule.
 */
export async function sessionRevoked(
  revoked: KVNamespace | undefined,
  sub: string,
  payload: Record<string, unknown>,
  logPrefix: string,
): Promise<boolean> {
  if (!revoked) {
    console.warn(`${logPrefix} auth_revocation_binding_missing: SESSION_REVOKED is not bound; admitted unchecked`);
    return false;
  }
  let record: unknown;
  try {
    record = await revoked.get(revocationKey(sub), 'json');
  } catch (err) {
    console.warn(`${logPrefix} auth_revocation_read_failed: ${err instanceof Error ? err.name : typeof err}; admitted`);
    return false;
  }
  return revocationRefusal(payload, record) !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO APP-WORKER BOUNDARIES. services/subscriptiontracker-api and every
// Worker stamped from the brick mount both; services/platform mounts neither
// (its `platformAuth` sets platform-only context and calls the plumbing above).
// ─────────────────────────────────────────────────────────────────────────────

/** The bindings the two boundaries read. Each carrier's `Env` satisfies it. */
export interface AuthBindings {
  readonly SUPABASE_URL: string;
  readonly JWKS_CACHE?: KVNamespace;
  readonly SESSION_REVOKED?: KVNamespace;
  readonly APP_ID?: string;
}

/** The members of Hono's request context the two boundaries use, and no more —
 *  no `hono` import, for the reason in the header. */
export interface AuthContext<E extends AuthBindings = AuthBindings> {
  readonly req: { header(name: string): string | undefined };
  readonly env: E;
  get(key: 'requestId'): string | undefined;
  set(key: 'userId', value: string): void;
  set(key: 'userEmail', value: string): void;
  set(key: 'tokenAssurance', value: TokenAssurance): void;
  set(key: 'authRecency', value: AuthRecency): void;
  json(object: { error: string }, status: 401): Response;
}

/**
 * The PERMISSIVE, LABELLED boundary every app route sits behind. On success sets
 * `userId` (+ `userEmail` when the token carries one), `tokenAssurance` and
 * `authRecency`, then calls next(). On any failure answers 401
 * `{ error: 'unauthorized' }` and nothing else.
 *
 * `legacyHs256Secret` reads the shared secret from the carrier's own environment
 * — the ONE line, in the carrier's `middleware/auth.ts`, that names it. A carrier
 * with no legacy project passes `() => undefined`.
 */
export function supabaseAuthWith<E extends AuthBindings>(options: {
  legacyHs256Secret: (env: E) => string | undefined;
}) {
  return async <C extends AuthContext<E>>(c: C, next: () => Promise<void>): Promise<Response | void> => {
    const token = bearer(c.req.header('Authorization') ?? '');
    if (token === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    try {
      const { payload, assurance } = await verifySupabaseToken(token, c.env.SUPABASE_URL, c.env.JWKS_CACHE, {
        legacyHs256Secret: options.legacyHs256Secret(c.env),
      });
      if (!payload.sub) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      // ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS — on BOTH verification paths, the
      // HS256 fallback included: a signed-out session's token is refused whichever
      // key verified it.
      const logPrefix = `[auth] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID}`;
      if (await sessionRevoked(c.env.SESSION_REVOKED, payload.sub, payload as Record<string, unknown>, logPrefix)) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      c.set('userId', payload.sub);
      c.set('tokenAssurance', assurance);
      c.set('authRecency', authRecencyOf(payload as Record<string, unknown>));
      const email = (payload as { email?: unknown }).email;
      if (typeof email === 'string') {
        c.set('userEmail', email);
      }
      await next();
      return;
    } catch {
      return c.json({ error: 'unauthorized' }, 401);
    }
  };
}

/**
 * 🔴 THE STRICTER BOUNDARY, FOR IRREVERSIBLE ROUTES ONLY.
 *
 * Identical to the permissive boundary except that there is NO fallback and no
 * path by which one could be reached: it calls [verifyAsymmetric], which is not
 * given the environment and therefore cannot see `SUPABASE_JWT_SECRET`. A token
 * signed with the legacy shared secret is a 401 here whether or not that secret
 * is configured. Whoever learns that one environment variable can mint a token
 * for any user, and behind `DELETE /v1/account` that is a remote wipe of
 * anybody's account. The cache IS used: it holds Supabase's own PUBLIC keys, so
 * verifying against it is still asymmetric proof, and without it a JWKS outage
 * would stop account deletion outright.
 *
 * It sets `tokenAssurance: 'asymmetric'`, which the erasure route then REQUIRES.
 * That second limb is not redundant: this middleware is attached by one line in
 * each Worker's `src/index.ts`, and a tidy-up can move a line; a refusal inside
 * the handler cannot be moved by accident.
 */
export async function erasureAuth<C extends AuthContext>(c: C, next: () => Promise<void>): Promise<Response | void> {
  const token = bearer(c.req.header('Authorization') ?? '');
  if (token === null) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  try {
    void warmJwksCache(c.env.SUPABASE_URL, c.env.JWKS_CACHE);
    const payload = await verifyAsymmetric(token, c.env.SUPABASE_URL, c.env.JWKS_CACHE);
    // `sub` IS the user id. A verified token with no subject authenticates
    // nobody, and letting it through would hand every `WHERE user_id = ?` an
    // undefined — which on a DELETE is the difference between erasing nothing
    // and being asked to erase everything.
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    // ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS — a signed-out session cannot delete
    // the account. Logged like the other refusals here, with no identifier.
    const logPrefix = `[erasure-auth] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID}`;
    if (await sessionRevoked(c.env.SESSION_REVOKED, payload.sub, payload as Record<string, unknown>, logPrefix)) {
      console.error(`${logPrefix} refused: the token's session was signed out.`);
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', payload.sub);
    c.set('tokenAssurance', 'asymmetric');
    // O-APP-API-DELETE-NO-RECENCY: read from the SAME verified payload, by the shared reader.
    c.set('authRecency', authRecencyOf(payload as Record<string, unknown>));
    const email = (payload as { email?: unknown }).email;
    if (typeof email === 'string') c.set('userEmail', email);
    await next();
    return;
  } catch (err) {
    // Logged, unlike the permissive boundary's silent 401: a refusal on the
    // erasure path is the one a user is most likely to report as "the delete
    // button does nothing", and the reason must be recoverable from the tail.
    // The token itself is never logged.
    console.error(
      `[erasure-auth] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID} refused: the bearer token did not verify against the JWKS (ES256). There is NO shared-secret fallback on this boundary.`,
      err instanceof Error ? err.message : err,
    );
    return c.json({ error: 'unauthorized' }, 401);
  }
}
