// ─────────────────────────────────────────────────────────────────────────────
// Test harness for services/subscriptiontracker-api.
//
// TWO kinds of database double, for two different questions:
//
//   · `realDb()` — a REAL SQL engine (node:sqlite) with the REAL migrations
//     applied, wrapped in D1's interface. Used wherever the property under test
//     is one a mock cannot evaluate: a mock does not enforce `AND user_id = ?`,
//     does not reject an `undefined` bind, and does not roll a batch back. The
//     tenancy and atomicity suites would all pass against a mock while the
//     Worker leaked rows and destroyed data — which is the whole reason this
//     Worker had no tests worth having.
//
//   · `RecordingDb` — records every SQL string and every bound value. Used where
//     the question IS "what value did the route decide to write", e.g. the
//     entitlement `is_active` the RevenueCat handler derives from an event.
//
// The migrations are imported with `?raw` rather than read with node:fs, so the
// schema under test is the schema that ships. Inlining a copy here would let the
// tests keep passing after a migration changed the tree.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import init0001 from '../migrations/0001_init.sql?raw';
import init0002 from '../migrations/0002_schema_debt.sql?raw';
import init0003 from '../migrations/0003_subscription_model.sql?raw';
import init0004 from '../migrations/0004_notice_days.sql?raw';
import init0005 from '../migrations/0005_lifecycle_history_categories.sql?raw';
import init0006 from '../migrations/0006_idempotency_keys.sql?raw';
import init0007 from '../migrations/0007_budget_currency.sql?raw';
import init0008 from '../migrations/0008_preferences.sql?raw';
import init0009 from '../migrations/0009_tags.sql?raw';
import type { AppEnv } from '../src/types';

/**
 * The engine: node:sqlite with the migrations applied, `batch` ONE transaction.
 *
 * ⏱ 2026-10-02 · port-sql. The engine that lived here is PROMOTED to
 * services/_shared/src/ports/fakes/sql.ts — tooling/ports/sql.json adapter
 * `sqlite`, held to the SQL port's conformance suite — and is the same engine
 * services/platform's harness runs. Re-exported under its old name for one PR,
 * so no test file had to change its import.
 */
import { SqliteDb } from '../../_shared/src/ports/fakes/sql';
export { SqliteDb as SqliteD1 };

/**
 * subscriptiontracker_db's migration set, IN APPLICATION ORDER, exactly as
 * `wrangler d1 migrations apply APP_DB` would apply it.
 *
 * Exported rather than kept inline in `realAppDb` because "this set re-applies
 * cleanly" is itself a property under test ([pipeline B-8]) and a replay test
 * must be able to name the set without re-listing it — a second list is a second
 * thing to forget to extend when 0003 lands. Same reasoning, and the same shape,
 * as `PLATFORM_MIGRATIONS` in services/platform/test/harness.ts.
 */
export const SUBLY_MIGRATIONS: readonly string[] = [
  init0001,
  init0002,
  init0003,
  init0004,
  init0005,
  init0006,
  init0007,
  init0008,
  init0009,
];

/** APP_DB with subscriptiontracker's real migrations applied, in order. `extraSchema` is for
 *  tests that need to force a DB-level failure the route cannot pre-empt (a
 *  trigger, say) in order to observe transaction behaviour. */
export function realAppDb(extraSchema: string[] = []): SqliteDb {
  return new SqliteDb([...SUBLY_MIGRATIONS, ...extraSchema]);
}

/**
 * The SHARED platform_db entitlements table — THE REAL MIGRATION, imported the
 * same way subscriptiontracker's own are.
 *
 * This used to be a hand-typed copy, with a comment claiming it was checked
 * against `src/types.ts` "in entitlements.test.ts" — a file that did not exist.
 * A copy is exactly the wrong shape for this table: it is owned and applied by
 * services/platform, so the drift that actually happens is that file changing
 * while the copy here sits still, and no assertion between two LOCAL
 * declarations can ever see that. The path crosses npm-project boundaries but
 * not the Vite root (the monorepo root is what `fs.allow` resolves to), so it
 * simply resolves — which the previous comment asserted it would not.
 */
import platformEntitlements from '../../platform/migrations/0001_entitlements.sql?raw';

export const ENTITLEMENTS_SCHEMA = platformEntitlements;

/**
 * The FULL platform_db migration set, imported from the harness that owns it
 * (services/platform/test/harness.ts exports it for exactly this reason — "a
 * second list is a second thing to forget to extend"). Until 2026-08-09 this
 * file applied 0001 alone, so every webhook test (the legacy RevenueCat route,
 * retired 2026-09-16) ran against a table WITHOUT
 * the 0004 money-rail columns (`occurred_at`, `provider_environment`, …) that
 * the production table has carried since the money rail landed — the
 * conditional-UPSERT ordering could not even be written against it.
 * `ENTITLEMENTS_SCHEMA` stays exported on its own: the schema-witness test in
 * entitlements.test.ts deliberately compares 0001's base contract.
 */
import { PLATFORM_MIGRATIONS } from '../../platform/test/harness';
export { PLATFORM_MIGRATIONS };

export function realPlatformDb(): SqliteDb {
  return new SqliteDb([...PLATFORM_MIGRATIONS]);
}

/** Records every prepared SQL string and every bound argument list. */
export class RecordingDb {
  sql: string[] = [];
  bound: unknown[][] = [];
  batches: number[] = [];

  prepare(sql: string) {
    this.sql.push(sql);
    const self = this;
    const mk = (): Record<string, unknown> => ({
      bind(...args: unknown[]) {
        self.bound.push(args);
        return mk();
      },
      async all() {
        return { results: [] };
      },
      async first() {
        return null;
      },
      async run() {
        return { meta: { changes: 1 } };
      },
    });
    return mk();
  }

  async batch(statements: unknown[]) {
    this.batches.push(statements.length);
    return [];
  }
}

// ⏱ 2026-09-16 — the `crypto.subtle.timingSafeEqual` shim that stood here is
// gone with its only caller: src/routes/webhooks.ts (the legacy RevenueCat
// route, O-REVENUECAT-VERIFIER leg b) was retired in favour of services/platform's
// POST /v1/money/revenuecat. Nothing left in this Worker compares a shared secret.

export const TEST_ENV = {
  APP_ID: 'subscriptiontracker',
  SUPABASE_URL: 'https://project.supabase.co',
  API_VERSION: 'v1',
  ALLOWED_ORIGINS: 'https://nikatru.com,https://subscriptiontracker-7qg.pages.dev',
  // [5]M-12 — the tests run as a LIVE deploy, like production wrangler.jsonc.
  // Suites that need the sandbox side override this per-harness.
  MONEY_ENVIRONMENT: 'live',
};

/**
 * Mount a route group behind a stub auth middleware that sets `userId` from an
 * `X-Test-User` header. Auth ITSELF is covered separately (auth.test.ts) against
 * the real `supabaseAuth`; here the point is what a route does once it knows who
 * is calling, and every route must be exercisable as two different users.
 */
export function asUser(
  route: Hono<AppEnv>,
  mountAt: string,
  bindings: Partial<AppEnv['Bindings']>,
  /** Without one, `c.executionCtx` THROWS, so a route's `waitUntil` hand-off
   *  is never reached — pass a double to put that branch under test. */
  executionCtx?: ExecutionContext,
) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const uid = c.req.header('X-Test-User');
    if (!uid) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', uid);
    c.set('requestId', 'test-rid');
    await next();
  });
  app.route(mountAt, route);
  app.onError((_err, c) => c.json({ error: 'internal_error' }, 500));

  const env = { ...TEST_ENV, ...bindings } as unknown as AppEnv['Bindings'];
  return (
    userId: string,
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    app.request(
      path,
      {
        method: init.method ?? 'GET',
        headers: {
          'X-Test-User': userId,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        body:
          init.body === undefined
            ? undefined
            : typeof init.body === 'string'
              ? init.body
              : JSON.stringify(init.body),
      },
      env,
      executionCtx,
    );
}
