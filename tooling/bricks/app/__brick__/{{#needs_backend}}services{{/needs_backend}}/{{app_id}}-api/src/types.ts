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
}

// Per-request variables set by middleware.
export interface Variables {
  requestId: string;
  userId: string;
  userEmail?: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
export type AppContext = Context<AppEnv>;
