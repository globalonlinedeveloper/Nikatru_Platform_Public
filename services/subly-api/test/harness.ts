// ─────────────────────────────────────────────────────────────────────────────
// Test harness for services/subly-api.
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
import type { DatabaseSync as DatabaseSyncCtor } from 'node:sqlite';
import { Hono } from 'hono';
import init0001 from '../migrations/0001_init.sql?raw';
import init0002 from '../migrations/0002_schema_debt.sql?raw';
import type { AppEnv } from '../src/types';

type SQLValue = string | number | bigint | null | Uint8Array;

// `node:sqlite` is fetched through `process.getBuiltinModule` rather than a
// static import: Vite's builtin list does not yet know the module, so
// `import ... from 'node:sqlite'` fails to resolve at transform time ("Failed to
// load url sqlite"). This bypasses module resolution entirely and needs no
// vitest config. The TYPES still come from the ambient declaration in
// node-sqlite.d.ts, so this stays type-checked.
type DatabaseSync = DatabaseSyncCtor;
const SqliteCtor = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:sqlite'): {
        DatabaseSync: new (path: string) => DatabaseSync;
      };
    };
  }
).process.getBuiltinModule('node:sqlite').DatabaseSync;

/** D1PreparedStatement over node:sqlite. `bind` returns a NEW statement, as D1's
 *  does — budget.ts binds one prepared statement many times in a single batch. */
class SqliteStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    return new SqliteStatement(this.db, this.sql, params);
  }

  private args(): SQLValue[] {
    return this.params.map((p) => {
      if (p === undefined) {
        // D1 rejects undefined binds (D1_TYPE_ERROR). node:sqlite throws too;
        // this makes the message recognisable in a failing test.
        throw new TypeError('D1_TYPE_ERROR: undefined is not a supported bind value');
      }
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p as SQLValue;
    });
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.args()) as T[] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.args()) as T) ?? null;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const r = this.db.prepare(this.sql).run(...this.args());
    return { meta: { changes: r.changes } };
  }
}

/** D1Database over node:sqlite. `batch` is ONE transaction, as D1's is. */
export class SqliteD1 {
  readonly db: DatabaseSync;

  constructor(schema: string[]) {
    this.db = new SqliteCtor(':memory:');
    for (const sql of schema) this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.db, sql);
  }

  async batch(statements: SqliteStatement[]): Promise<unknown[]> {
    this.db.exec('BEGIN');
    try {
      const out: unknown[] = [];
      for (const s of statements) out.push(await s.run());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Direct read, bypassing the Worker — for asserting what actually landed. */
  rows(sql: string, ...params: SQLValue[]): Array<Record<string, unknown>> {
    return this.db.prepare(sql).all(...params);
  }
}

/**
 * subly_db's migration set, IN APPLICATION ORDER, exactly as
 * `wrangler d1 migrations apply APP_DB` would apply it.
 *
 * Exported rather than kept inline in `realAppDb` because "this set re-applies
 * cleanly" is itself a property under test ([pipeline B-8]) and a replay test
 * must be able to name the set without re-listing it — a second list is a second
 * thing to forget to extend when 0003 lands. Same reasoning, and the same shape,
 * as `PLATFORM_MIGRATIONS` in services/platform/test/harness.ts.
 */
export const SUBLY_MIGRATIONS: readonly string[] = [init0001, init0002];

/** APP_DB with subly's real migrations applied, in order. `extraSchema` is for
 *  tests that need to force a DB-level failure the route cannot pre-empt (a
 *  trigger, say) in order to observe transaction behaviour. */
export function realAppDb(extraSchema: string[] = []): SqliteD1 {
  return new SqliteD1([...SUBLY_MIGRATIONS, ...extraSchema]);
}

/**
 * The SHARED platform_db entitlements table — THE REAL MIGRATION, imported the
 * same way subly's own are.
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

export function realPlatformDb(): SqliteD1 {
  return new SqliteD1([ENTITLEMENTS_SCHEMA]);
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

// ── one Workers-runtime API Node's WebCrypto does not have ───────────────────
// `crypto.subtle.timingSafeEqual` is a Cloudflare Workers extension, and
// webhooks.ts uses it for the shared-secret comparison. Without this shim the
// route THROWS in Node and every webhook test reports a 500 — which is
// indistinguishable from a request the handler deliberately rejected, i.e. the
// suite would look like it was testing rejection while testing a crash.
// Constant-time-ness is a property of the deployed runtime, not of this shim;
// what is being restored here is presence.
{
  const subtle = (
    globalThis as unknown as {
      crypto?: {
        subtle?: {
          timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
        };
      };
    }
  ).crypto?.subtle;
  if (subtle && typeof subtle.timingSafeEqual !== 'function') {
    subtle.timingSafeEqual = (a, b) => {
      const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      if (x.byteLength !== y.byteLength) {
        throw new TypeError('timingSafeEqual: inputs must have the same length');
      }
      let diff = 0;
      for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
      return diff === 0;
    };
  }
}

export const TEST_ENV = {
  APP_ID: 'subly',
  SUPABASE_URL: 'https://project.supabase.co',
  API_VERSION: 'v1',
  ALLOWED_ORIGINS: 'https://subly.nikatru.com,https://subly-9cp.pages.dev',
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
    init: { method?: string; body?: unknown } = {},
  ) =>
    app.request(
      path,
      {
        method: init.method ?? 'GET',
        headers: {
          'X-Test-User': userId,
          'Content-Type': 'application/json',
        },
        body:
          init.body === undefined
            ? undefined
            : typeof init.body === 'string'
              ? init.body
              : JSON.stringify(init.body),
      },
      env,
    );
}
