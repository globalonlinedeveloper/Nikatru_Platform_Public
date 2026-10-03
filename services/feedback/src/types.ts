// ─────────────────────────────────────────────────────────────────────────────
// types.ts — the feedback intake's bindings (lane feedback-intake).
//
// Every binding is a PORT (tooling/ports/README.md): the SQL store is `SqlDb`,
// the screenshot bucket `ObjectStore`, the KV caches `KvStore`. A Cloudflare
// binding satisfies each structurally (services/_shared/src/ports/adapters/
// cloudflare.ts); the tests hand in the fakes from services/_shared/src/ports/fakes.
// ─────────────────────────────────────────────────────────────────────────────
import type { AuthRecency } from '../../_shared/src/auth';
import type { KvStore } from '../../_shared/src/ports/kv';
import type { ObjectStore } from '../../_shared/src/ports/objects';
import type { RateLimiter } from '../../_shared/src/ports/ratelimit';
import type { SqlDb } from '../../_shared/src/ports/sql';
import type { TokenAssurance } from '../../_shared/src/auth-middleware';
import type { Context } from 'hono';

export interface Env {
  /** platform_db (APAC, C-APAC-RESIDENCY): `feedback_reports` and its helpers,
   *  migrated by services/platform/migrations/0025_feedback.sql. This Worker never
   *  migrates it. */
  PLATFORM_DB: SqlDb;
  /** The PRIVATE screenshot bucket. No public access, no custom domain, and no
   *  route of this Worker's `fetch` reads it: the one read path is the
   *  `FeedbackInternal` entrypoint (src/internal.ts), reachable only over a
   *  Service Binding inside the account. */
  SCREENSHOTS: ObjectStore;
  /** The per-network burst bound, FAIL CLOSED (wrangler.jsonc `ratelimits`). */
  FEEDBACK_EDGE_LIMITER?: RateLimiter;
  JWKS_CACHE: KvStore;
  /** The shared revocation list, READ ONLY (services/platform writes it). */
  SESSION_REVOKED?: KvStore;
  APP_ID: string;
  SUPABASE_URL: string;
  API_VERSION: string;
  ALLOWED_ORIGINS?: string;
  /** THE GO-LIVE FLAG. Anything but "true" answers POST /v1/feedback with 503
   *  `intake_closed`, so a client keeps the report in its outbox and offers the
   *  support mail. The lead flips it after the first deploy (PR body, lead steps). */
  INTAKE_OPEN?: string;
  SUPABASE_JWT_SECRET?: string;
  /** The `feedback` mail stream's key (tooling/ports/mail.json), the reports
   *  key the platform Worker holds. Absent ⇒ no receipt and no notice is sent;
   *  every report is still stored. `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY?: string;
  /** The bearer of POST /v1/ops/feedback/move, held by the lead's laptop for
   *  tooling/feedback/move.mjs. Absent ⇒ the route answers 503. */
  FEEDBACK_OPS_SECRET?: string;
  /** The crash sink's DSN, a `--var` at deploy time; absent ⇒ no report. */
  GLITCHTIP_DSN?: string;
  /** The deployed commit, `--var RELEASE:<sha>`. */
  RELEASE?: string;
}

export interface Variables {
  requestId: string;
  userId: string;
  userEmail?: string;
  tokenAssurance?: TokenAssurance;
  authRecency?: AuthRecency;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
export type AppContext = Context<AppEnv>;
