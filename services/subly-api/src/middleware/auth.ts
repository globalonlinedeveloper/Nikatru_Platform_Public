// ─────────────────────────────────────────────────────────────────────────────
// supabaseAuth — verifies the Supabase JWT on the Authorization header.
//
// SWAP-PROVIDER NOTE: this is the ONLY file that knows we use Supabase. To move
// to Firebase (or Auth0, Clerk, ...), rewrite the verification block below to
// point at that provider's issuer + JWKS URL; the rest of the app just reads
// c.get('userId') / c.get('userEmail'). Keep this file the single seam.
//
// Verification strategy:
//   PRIMARY  — asymmetric (RS256/ES256): fetch Supabase's JWKS and verify the
//              signature, issuer and audience. The JWKS is cached in KV for a
//              short TTL to cut cold-verify latency and reduce egress.
//   FALLBACK — legacy HS256: if SUPABASE_JWT_SECRET is configured, verify with
//              the shared secret. Some older Supabase projects still sign HS256.
//
// ── 🔴 THE FALLBACK IS NOW NAMED IN THE CONTEXT, NOT JUST IN THIS COMMENT ────
// `supabaseAuth` records HOW the token was verified as `tokenAssurance`
// ('asymmetric' | 'symmetric'). Until it did, "this request was authenticated by
// a shared secret" was a fact that existed for one stack frame and then vanished,
// so no route could refuse on it and no test could observe it — which is exactly
// how an irreversible route ends up behind a symmetric secret without anybody
// choosing that.
//
// The consequence a shared secret has that a signature does not: ONE leaked
// environment variable mints a token for ANY user. That is survivable for a read
// of your own subscriptions (the blast radius is one app's rows, and the rows are
// still there afterwards). It is not survivable for erasure, which is
// irreversible and which the store review process treats as the account's
// destructor. So [erasureAuth] below exists as a SEPARATE, STRICTER middleware
// with no secret in scope at all, and the erasure route additionally refuses any
// request whose `tokenAssurance` is not 'asymmetric' — see
// src/routes/account.ts. Two independent limbs, because the mounting is a line
// somebody can move and the route-level check is not.
// ─────────────────────────────────────────────────────────────────────────────

import type { MiddlewareHandler } from 'hono';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { AppEnv, Env, TokenAssurance } from '../types';

const JWKS_KV_KEY = 'supabase_jwks';
/**
 * @ceiling none — and the reason is that the relation is INVERSE, so an `lte`
 * comparison against `kv.writesPerDay` would be arithmetic that cannot fail and
 * would therefore overstate what is checked.
 *
 * The resource this bounds is KV WRITES, whose Free ceiling is 1,000/day
 * (`tooling/ceilings.json` → `kv.writesPerDay`) — and a LARGER TTL spends FEWER
 * of them, not more. The arithmetic, written out because it is the whole
 * justification for the value: one write per expiry gives 86400/600 = 144
 * writes/day per namespace, ~14% of the Free daily budget, shared with the
 * config namespace. Halving this constant doubles that; taking it to 60s would
 * spend 1,440/day and exhaust the account's entire KV write budget on a cache.
 */
const JWKS_TTL_SECONDS = 600; // 10 minutes

// Cache the remote JWKS *getter* per SUPABASE_URL for the lifetime of the
// isolate. createRemoteJWKSet keeps its own in-memory cache + coalescing, and
// only refetches when it sees an unknown `kid`. We additionally stash the raw
// JWKS JSON in KV (below) so a cold isolate can warm-start without a round-trip
// to Supabase on the very first request.
const remoteSetCache = new Map<string, JWTVerifyGetKey>();

function getRemoteJWKS(supabaseUrl: string): JWTVerifyGetKey {
  let set = remoteSetCache.get(supabaseUrl);
  if (!set) {
    set = createRemoteJWKSet(
      new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
    );
    remoteSetCache.set(supabaseUrl, set);
  }
  return set;
}

/**
 * Best-effort warm of the KV-cached JWKS. We don't feed this into jose's getter
 * (jose manages its own fetch), but keeping a fresh copy in KV lets us prefetch
 * cheaply and gives an operational cache we can inspect. Failures are swallowed.
 */
async function warmJwksCache(env: Env): Promise<void> {
  try {
    const cached = await env.JWKS_CACHE.get(JWKS_KV_KEY);
    if (cached) return; // still warm
    const res = await fetch(
      `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
    );
    if (!res.ok) return;
    const body = await res.text();
    await env.JWKS_CACHE.put(JWKS_KV_KEY, body, {
      expirationTtl: JWKS_TTL_SECONDS,
    });
  } catch {
    // Non-fatal: verification still works via jose's own fetch.
  }
}

/**
 * 🔴 THE JWKS FAILED CLOSED HERE TOO, AND ON THIS WORKER IT FAILED TWO
 * DIFFERENT WAYS, ONE OF THEM SILENT.
 *
 * `services/platform` got this fix in #433. THIS file did not, and it is
 * `api.nikatru.com` — the product's data API. Read from jose's own source
 * (`src/jwks/remote.ts`): `createRemoteJWKSet` keeps a per-isolate, in-memory
 * cache and **on a failed fetch the error propagates — there is no fallback to a
 * previously cached key set.** `warmJwksCache` below already kept a copy in KV
 * and its own comment said *"we don't feed this into jose's getter"*. Nothing
 * read it on the failure path. It does now.
 *
 * What an unreachable JWKS endpoint did to THIS worker, before this change:
 *
 *   · [supabaseAuth] — the asymmetric path threw, and `verifySupabaseToken`
 *     caught it and tried the LEGACY HS256 SHARED SECRET. So when
 *     `SUPABASE_JWT_SECRET` is configured, a Box A outage did not 401: it
 *     SILENTLY DOWNGRADED every authenticated request from a signature to a
 *     shared string, and recorded `tokenAssurance: 'symmetric'` while doing it.
 *     [erasureAuth]'s own comment already named this exact hazard — *"a fallback
 *     that triggers on ANY primary failure triggers when Supabase is merely
 *     unreachable"* — and it was live on the permissive boundary.
 *   · [erasureAuth] — no fallback of any kind, so the outage was a hard 401 and
 *     account deletion stopped working entirely.
 *
 * Both are fixed by the same limb, and it makes the downgrade RARER rather than
 * more likely: the asymmetric path now survives the outage, so the HS256 branch
 * is not reached by mere unreachability.
 *
 * ⚠️ WHY THIS TAKES A `KVNamespace` AND NOT `Env`, WHICH IS NOT A STYLE CHOICE.
 * [verifyAsymmetric] deliberately receives `supabaseUrl` rather than the
 * environment, so *"this path cannot fall back to a shared secret"* is a
 * property of the SIGNATURE — checkable by reading four lines — rather than a
 * claim about a body a later edit could falsify. Handing it `Env` to reach
 * `JWKS_CACHE` would have destroyed exactly that guarantee, in the file whose
 * comments rest on it. It gets the ONE binding it needs. The cached JWKS is a
 * PUBLIC document, so caching it adds no secret to this scope.
 */
const verifyOptions = (supabaseUrl: string) => ({
  issuer: `${supabaseUrl}/auth/v1`,
  audience: 'authenticated',
  // 🔴 PINNED. Without this the TOKEN decides how it is verified — a header
  // saying `alg: none`, or `alg: HS256` against a key the verifier holds.
  algorithms: ['ES256'],
});

/**
 * Could the KEY SET not be obtained, as distinct from the token being bad?
 *
 * 🔴 CORRECTED, AND THE CORRECTION MATTERS MORE ON THIS FILE THAN ON PLATFORM.
 * The first version of this predicate was BOTH TOO NARROW TO FIRE IN PRODUCTION
 * AND TOO WIDE TO BE SAFE, and it passed its tests either way. Established by
 * reading the INSTALLED jose dist (`dist/browser/`, the build these Workers
 * bundle), not from memory.
 *
 * TOO NARROW: it keyed on `err instanceof TypeError`, justified as "what undici
 * raises". Undici is NODE; these Workers run on workerd and the tests run in
 * Node, so the one shape the tests exercised is the one production cannot
 * produce. And `runtime/fetch_jwks.js` turns a NON-200 into bare
 * `JOSEError("Expected 200 OK ...")` - which is the MOST LIKELY outage shape,
 * because Box A is reached through a Cloudflare Tunnel and a tunnel with no
 * origin answers 502/530.
 *
 * 🔴 ON THIS FILE THAT MISS WAS NOT MERELY A 401. A primary failure here falls
 * through to the LEGACY HS256 SHARED SECRET, so the commonest outage shape would
 * still have silently downgraded every request from a signature to a shared
 * string. Widening the predicate correctly is what actually closes that.
 *
 * TOO WIDE: it accepted `ERR_JWKS_NO_MATCHING_KEY` and
 * `ERR_JWKS_MULTIPLE_MATCHING_KEYS`. Those are raised AFTER a key set was
 * obtained and mean "your `kid` is not in it" - a fact about the TOKEN. Falling
 * back to a stale cache on them is a second bite at verification against an
 * OLDER key set, so a token signed by a ROTATED-OUT key would have been
 * accepted from the cache. Both codes are gone.
 *
 * WHAT IT KEYS ON NOW: `ERR_JWKS_TIMEOUT`; `ERR_JOSE_GENERIC` (measured - a grep
 * for `new JOSEError(` over the entire installed browser dist returns EXACTLY
 * TWO hits, both in `runtime/fetch_jwks.js`, so this is narrow, not broad); and
 * an error carrying NO jose `code`, which can only have come from the runtime
 * `fetch` because `fetch_jwks.js` rethrows that rejection unwrapped.
 *
 * ⚠️ STILL NOT THE NEGATIVE TEST THAT WAS RIGHTLY REFUSED: every jose class sets
 * a `code` in its constructor, so a FUTURE jose class arrives WITH one and is
 * excluded by the last clause rather than swept into the fallback - and on this
 * file that is what keeps a bad token from reaching the HS256 branch twice.
 */
function isKeySetUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  // No jose code at all => the runtime fetch failed (workerd network errors,
  // undici TypeError). Not a verification outcome.
  if (typeof code !== 'string') return true;
  if (code === 'ERR_JWKS_TIMEOUT' || code === 'ERR_JOSE_GENERIC') return true;
  // A non-jose code such as ECONNREFUSED / ENOTFOUND is still a transport
  // failure; every jose code is prefixed `ERR_`.
  return !code.startsWith('ERR_');
}

async function localSetFromCache(
  jwksCache: KVNamespace | undefined,
): Promise<JWTVerifyGetKey | null> {
  try {
    if (!jwksCache) return null;
    const cached = await jwksCache.get(JWKS_KV_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as { keys?: unknown[] };
    // An EMPTY key set is not a usable fallback — it is exactly what a
    // misconfigured GoTrue publishes, and treating it as one would turn a
    // configuration error into a silent, permanent 401 nobody could diagnose.
    if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) return null;
    return createLocalJWKSet(parsed as Parameters<typeof createLocalJWKSet>[0]);
  } catch {
    // A corrupt or unparseable cache is no cache. Fail closed, as before.
    return null;
  }
}

/**
 * THE ASYMMETRIC PATH, ON ITS OWN, WITH NO SECRET IN SCOPE.
 *
 * 🔴 It takes `SUPABASE_URL` rather than `Env` ON PURPOSE. A function that never
 * receives the environment cannot read `SUPABASE_JWT_SECRET`, so "this path
 * cannot fall back to a shared secret" is a property of the SIGNATURE — checkable
 * by reading four lines — rather than a claim about the body that a later edit
 * could quietly falsify. `warmJwksCache` still wants the env, so the caller warms
 * the cache; this function does one thing.
 */
async function verifyAsymmetric(
  token: string,
  supabaseUrl: string,
  jwksCache?: KVNamespace,
): Promise<JWTPayload> {
  const opts = verifyOptions(supabaseUrl);
  try {
    const { payload } = await jwtVerify(token, getRemoteJWKS(supabaseUrl), opts);
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

async function verifySupabaseToken(
  token: string,
  env: Env,
): Promise<{ payload: JWTPayload; assurance: TokenAssurance }> {
  const issuer = `${env.SUPABASE_URL}/auth/v1`;

  // PRIMARY: asymmetric verification via remote JWKS (alg pinned to ES256).
  try {
    // Fire-and-forget KV warm; verification does not block on it.
    void warmJwksCache(env);
    return {
      payload: await verifyAsymmetric(token, env.SUPABASE_URL, env.JWKS_CACHE),
      assurance: 'asymmetric',
    };
  } catch (primaryErr) {
    // FALLBACK: legacy HS256 shared-secret verification, if configured.
    // Issuer + alg enforced: a token from any OTHER Supabase project must fail.
    if (env.SUPABASE_JWT_SECRET) {
      const key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, key, {
        issuer,
        audience: 'authenticated',
        algorithms: ['HS256'],
      });
      // ⚠️ 'symmetric' IS THE POINT OF THIS RETURN. The route that must never
      // run on it reads exactly this value.
      return { payload, assurance: 'symmetric' };
    }
    throw primaryErr;
  }
}

/** The `Bearer <token>` part of an Authorization header, or null. */
const bearer = (authz: string): string | null => /^Bearer\s+(.+)$/i.exec(authz)?.[1] ?? null;

/**
 * Hono middleware. On success sets `userId` (+ optional `userEmail`) and
 * `tokenAssurance`, then calls next(). On any failure returns 401 JSON
 * `{ error: 'unauthorized' }`.
 */
export const supabaseAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c.req.header('Authorization') ?? '');
  if (token === null) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  try {
    const { payload, assurance } = await verifySupabaseToken(token, c.env);
    if (!payload.sub) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', payload.sub);
    c.set('tokenAssurance', assurance);
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

/**
 * 🔴 THE STRICTER BOUNDARY, FOR IRREVERSIBLE ROUTES ONLY.
 *
 * Identical to [supabaseAuth] except that there is NO fallback and no path by
 * which one could be reached: it calls [verifyAsymmetric], which is not given the
 * environment and therefore cannot see `SUPABASE_JWT_SECRET`. A token signed with
 * the legacy shared secret is a 401 here whether or not that secret is
 * configured, and `services/platform/src/middleware/auth.ts` explains at length
 * why that is the right trade for a destructive route: the asymmetric path needs
 * no secret at all (the JWKS is public), so the fallback buys nothing here that
 * is worth what it costs — and a fallback that triggers on ANY primary failure
 * triggers when Supabase is merely unreachable, which silently downgrades the
 * boundary from a signature to a shared string at exactly the wrong moment.
 *
 * It sets `tokenAssurance: 'asymmetric'`, which the erasure route then REQUIRES.
 * That second limb is not redundant: this middleware is attached by one line in
 * `src/index.ts`, and the failure this whole change exists to prevent is somebody
 * moving the route under the permissive group in a tidy-up. The mounting can be
 * changed by accident; a refusal inside the handler cannot.
 */
export const erasureAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c.req.header('Authorization') ?? '');
  if (token === null) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  try {
    void warmJwksCache(c.env);
    const payload = await verifyAsymmetric(
      token,
      c.env.SUPABASE_URL,
      c.env.JWKS_CACHE,
    );
    // `sub` IS the user id. A verified token with no subject authenticates
    // nobody, and letting it through would hand every `WHERE user_id = ?` an
    // undefined — which on a DELETE is the difference between erasing nothing
    // and being asked to erase everything.
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', payload.sub);
    c.set('tokenAssurance', 'asymmetric');
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
};
