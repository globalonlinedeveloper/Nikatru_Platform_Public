import type { AuthRecency } from '../../_shared/src/auth';
import type { Context } from 'hono';

// Bindings from wrangler.jsonc. APP_DB is the ONLY per-app resource;
// PLATFORM_DB + JWKS_CACHE + SUPABASE_URL are shared across every NIKATRU app.
// There is deliberately no R2 binding: object storage is one portfolio bucket
// bound in `services/platform` and keyed by an `<app_id>/` prefix.
export interface Env {
  APP_DB: D1Database;
  PLATFORM_DB: D1Database;
  JWKS_CACHE: KVNamespace;
  // ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS. The shared revocation list
  // (`rev:<sub>`), READ ONLY here, by middleware/auth.ts; services/platform
  // writes it. Optional: absence fails OPEN, and
  // tooling/ci/assert-session-revocation.mjs reds a config that does not bind it.
  SESSION_REVOKED?: KVNamespace;
  APP_ID: string;
  SUPABASE_URL: string;
  API_VERSION: string;
  ALLOWED_ORIGINS?: string;
  // Optional legacy HS256 fallback secret (most projects use ES256 JWKS).
  SUPABASE_JWT_SECRET?: string;
  // ⏱ 2026-09-24 · O-BRICK-ERASURE-DESTROYS-THE-IDENTITY: the service-role
  // credential field that stood here is GONE, with the identity delete that
  // needed it. A stamped Worker erases its own APP_DB rows and nothing else; the
  // identity record is deleted by the shared platform Worker alone
  // (services/platform/src/lib/platform-erasure.ts). A key this Worker never
  // reads is a key nobody should be asked to set on it.
  /**
   * [pipeline 11]E-8 — the crash sink for UNHANDLED WORKER ERRORS. A `var`, not
   * a secret: a GlitchTip DSN is a write-only ingest key this factory already
   * ships inside every web build. Absent ⇒ no report, silently; `lib/
   * error-sink.ts` fails open by design, so a missing DSN degrades reporting and
   * never the request.
   */
  GLITCHTIP_DSN?: string;
  /**
   * The commit this Worker was deployed from — `--var RELEASE:<sha>`, supplied by
   * `deploy-workers.yml`. NOT `API_VERSION`, which is the literal "v1" and would
   * group every error this app ever reports into one bucket;
   * `tooling/ci/assert-worker-error-sink.mjs` fails a sink that reads it.
   */
  RELEASE?: string;
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
  /**
   * ⏱ 2026-09-16 · O-APP-API-DELETE-NO-RECENCY. How the verified token's user
   * signs in and when they last AUTHENTICATED, set by both auth middlewares from
   * the payload they verified. The erasure route refuses when it is absent
   * (services/_shared/src/auth.ts).
   */
  authRecency?: AuthRecency;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
export type AppContext = Context<AppEnv>;
