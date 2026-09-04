import type { Context } from 'hono';

// Bindings from wrangler.jsonc. APP_DB is the ONLY per-app resource;
// PLATFORM_DB + JWKS_CACHE + SUPABASE_URL are shared across every NIKATRU app.
// There is deliberately no R2 binding: object storage is one portfolio bucket
// bound in `services/platform` and keyed by an `<app_id>/` prefix.
export interface Env {
  APP_DB: D1Database;
  PLATFORM_DB: D1Database;
  JWKS_CACHE: KVNamespace;
  APP_ID: string;
  SUPABASE_URL: string;
  API_VERSION: string;
  ALLOWED_ORIGINS?: string;
  // Optional legacy HS256 fallback secret (most projects use ES256 JWKS).
  SUPABASE_JWT_SECRET?: string;
  // 🔴 G2. The ONLY credential that can delete an identity record
  // (`DELETE /auth/v1/admin/users/<id>`). Optional in the TYPE and REQUIRED in
  // practice: `DELETE /v1/account` refuses with 501 when it is unset, because a
  // deletion that leaves the login working is one the user can never detect.
  // NEVER a `var` — set with `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`.
  // It bypasses RLS, so nothing outside routes/account.ts may read it.
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/**
 * HOW STRONGLY THIS REQUEST'S TOKEN WAS PROVED, and it is not a diagnostic.
 *
 * `asymmetric` — ES256, verified against Supabase's PUBLIC JWKS. The private
 * half never leaves Supabase, so a token that verifies was minted by Supabase.
 * `symmetric` — HS256 against the shared `SUPABASE_JWT_SECRET`, used only when
 * the asymmetric path fails and that secret is set. **Anyone who learns that one
 * environment variable can mint a token for any user.** Behind a read that is a
 * data leak; behind an irreversible route it is a remote wipe of any account.
 *
 * 🔴 `src/routes/account.ts` refuses anything that is not `'asymmetric'`, and
 * that check is the second of two independent limbs — the first being that
 * `index.ts` mounts the erasure route behind [erasureAuth], which has no secret
 * in scope at all.
 */
export type TokenAssurance = 'asymmetric' | 'symmetric';

// Per-request variables set by middleware.
export interface Variables {
  requestId: string;
  userId: string;
  userEmail?: string;
  /**
   * ⚠️ OPTIONAL, AND ITS ABSENCE MUST READ AS A REFUSAL. A route reached with no
   * auth middleware at all sees `undefined`, which is not `'asymmetric'` — so
   * the erasure check fails closed. Spelling that check `!== 'symmetric'` would
   * invert exactly that property.
   */
  tokenAssurance?: TokenAssurance;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
export type AppContext = Context<AppEnv>;
