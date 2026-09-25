import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import account from '../src/routes/account';
import type { AppEnv, Env } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// account-route.test.ts — ⏱ 2026-09-24 · O-BRICK-ERASURE-DESTROYS-THE-IDENTITY.
// THE STAMPED ERASURE ROUTE IS A FAN-OUT LEAF: it erases this app's APP_DB rows
// and nothing else.
//
// Until today every stamped Worker was a SECOND identity deleter — the route
// deleted the shared entitlements with PLATFORM_DB and then the identity itself,
// with the service-role key. The identity has one deleter, in the shared platform
// Worker, and this file holds the stamped half to that from the inside:
//
//   · the route answers ok after erasing the caller's APP_DB rows, and the
//     requests it MADE are the evidence that it deleted no identity — a return
//     value can be faked, an outbound call cannot be hidden from a stub;
//   · it never reads PLATFORM_DB, asserted on every property access;
//   · Env carries no service-role field, which `tsc --noEmit` enforces through
//     the `@ts-expect-error` below as well as this run.
//
// The route is mounted as index.ts mounts it (`/v1/account`), behind a stand-in
// for `erasureAuth` that sets exactly what that middleware sets. The auth
// boundary itself is not under test here: `assert-erasure-reach.mjs` T3 holds
// the mounting, and the handler's own `tokenAssurance` refusal is kept verbatim.
//
// The APP_DB double is erasure-entrypoint.test.ts's, answering the statements
// the shared walk sends (measured against workerd's D1 there, 2026-09-18).
// ─────────────────────────────────────────────────────────────────────────────

const nodeProcess = (
  globalThis as unknown as {
    process: { cwd(): string; getBuiltinModule(id: 'node:fs'): { readFileSync(p: string, enc: 'utf8'): string } };
  }
).process;
const read = (rel: string) => nodeProcess.getBuiltinModule('node:fs').readFileSync(`${nodeProcess.cwd()}/${rel}`, 'utf8');

/** One table, `records (id, user_id)`, answering exactly the statements the shared walk sends. */
function fakeDb(rows: Array<{ id: string; user_id: string }>) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => {
      if (/FROM sqlite_master/i.test(sql)) return { results: [{ name: 'records' }] };
      if (/pragma_table_info\('records'\)/i.test(sql)) return { results: [{ name: 'id' }, { name: 'user_id' }] };
      return { results: [] };
    },
    run: async () => {
      if (/^DELETE FROM records WHERE user_id = \?/i.test(sql)) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].user_id === args[0]) rows.splice(i, 1);
        return { meta: { changes: before - rows.length } };
      }
      return { meta: { changes: 0 } };
    },
  });
  type Stmt = ReturnType<typeof stmt>;
  const batch = async (statements: Stmt[]) => {
    const snapshot = rows.map((r) => ({ ...r }));
    try {
      const out: Array<{ results: unknown[]; meta: { changes: number } }> = [];
      for (const s of statements) {
        if (/^\s*SELECT\b/i.test(s.sql)) out.push({ results: (await s.all()).results, meta: { changes: 0 } });
        else out.push({ results: [], meta: (await s.run()).meta });
      }
      return out;
    } catch (err) {
      rows.splice(0, rows.length, ...snapshot);
      throw err;
    }
  };
  return { prepare: (sql: string) => stmt(sql), batch } as unknown as D1Database;
}

/** A PLATFORM_DB that records every property anyone reads off it. */
function watchedPlatformDb(touched: string[]) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        touched.push(String(prop));
        return () => {
          throw new Error(`the stamped erasure route touched PLATFORM_DB.${String(prop)}`);
        };
      },
    },
  ) as unknown as D1Database;
}

/** The route, mounted where index.ts mounts it, behind what `erasureAuth` sets. */
function mounted() {
  const app = new Hono<AppEnv>();
  app.use('/v1/account', async (c, next) => {
    c.set('requestId', 'test-rid');
    c.set('userId', 'subject');
    c.set('tokenAssurance', 'asymmetric');
    // A password account: `deletionRecencyRefusal` holds a password account to no
    // recency window at either end, so this context is admitted.
    c.set('authRecency', { passwordless: false, lastAuthenticatedAt: null });
    await next();
  });
  app.route('/v1/account', account);
  return app;
}

function env(appDb: D1Database, platformDb: D1Database): Env {
  return {
    APP_DB: appDb,
    PLATFORM_DB: platformDb,
    JWKS_CACHE: {} as KVNamespace,
    APP_ID: 'probe',
    SUPABASE_URL: 'https://identity.test.invalid',
    API_VERSION: 'v1',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DELETE /v1/account on a stamped Worker — this app\'s APP_DB rows and nothing else', () => {
  it('erases APP_DB rows for the caller and makes NO outbound request', async () => {
    // Every request the route makes is recorded AND answered 204, so an identity
    // delete that came back would succeed here and still be caught below — the
    // assertion is on what was SENT, never on what the route reports.
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response(null, { status: 204 });
    });
    const rows = [
      { id: '1', user_id: 'subject' },
      { id: '2', user_id: 'bystander' },
    ];
    const res = await mounted().request('/v1/account', { method: 'DELETE' }, env(fakeDb(rows), watchedPlatformDb([])));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deleted: { records: 1 } });
    expect(rows).toEqual([{ id: '2', user_id: 'bystander' }]);
    expect(sent).toEqual([]);
  });

  it('does not touch PLATFORM_DB', async () => {
    const touched: string[] = [];
    const res = await mounted().request(
      '/v1/account',
      { method: 'DELETE' },
      env(fakeDb([{ id: '1', user_id: 'subject' }]), watchedPlatformDb(touched)),
    );
    expect(res.status).toBe(200);
    expect(touched).toEqual([]);
  });

  it('Env declares no SUPABASE_SERVICE_ROLE_KEY', () => {
    const e = env(fakeDb([]), watchedPlatformDb([]));
    // @ts-expect-error — the stamped Worker holds no service-role credential; `tsc --noEmit` fails here if the field returns.
    const key: unknown = e.SUPABASE_SERVICE_ROLE_KEY;
    expect(key).toBeUndefined();
    expect(read('src/types.ts')).not.toMatch(/\bSUPABASE_SERVICE_ROLE_KEY\b/);
    expect(read('src/routes/account.ts')).not.toMatch(/\bSUPABASE_SERVICE_ROLE_KEY\b/);
  });
});
