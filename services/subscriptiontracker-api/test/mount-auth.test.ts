import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { app } from '../src/index';
import type { AppEnv } from '../src/types';
import { TEST_ENV, realAppDb, realPlatformDb, type SqliteD1 } from './harness';
import { anonymousNotRefused, es256Issuer, jwksFetch, type Through } from '../../_shared/test/mount-auth';
import { mountedEndpoints, probePath } from '../../_shared/test/preflight';

// ─────────────────────────────────────────────────────────────────────────────
// mount-auth.test.ts — AN UNAUTHENTICATED REQUEST THROUGH THE REAL APP.
//
// ⏱ 2026-10-01 · rv2-services-024 (lane fix-st-api-bounds). Every route suite
// here mounts its router behind the harness's stub (`asUser`, an X-Test-User
// header), and tenancy.test.ts's "refuses a caller with no identity" case
// asserts THAT STUB's 401. So no pre-merge test sent a request with no
// credential, or a bad one, through `src/index.ts` as it is mounted: a data
// route mounted on `app` instead of the `api` group (behind no `supabaseAuth`)
// would have been green in every suite. This drives the REAL app, with the
// endpoint set DERIVED from `app.routes` (the kit's `mount-auth` over
// `mountedEndpoints`), so a route added later is covered by existing.
//
// Red control (run at authoring): `app.route('/v1/subscriptions', subscriptions)`
// added ahead of the erasure mount in src/index.ts → both tests red, naming
// `GET /v1/subscriptions answered 500 to a caller with no credential` (the
// route ran with no `userId`) and every other subscriptions endpoint.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC = [{ method: 'GET', path: '/v1/health' }];
/** Floor on the derived set: a route table that stopped being read cannot pass empty. */
const MIN_GUARDED = 12;

let appDb: SqliteD1;
let platformDb: SqliteD1;

beforeEach(async () => {
  appDb = realAppDb();
  platformDb = realPlatformDb();
  const { jwks } = await es256Issuer();
  vi.stubGlobal('fetch', jwksFetch(TEST_ENV.SUPABASE_URL, jwks));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = () =>
  ({ ...TEST_ENV, APP_DB: appDb, PLATFORM_DB: platformDb }) as unknown as AppEnv['Bindings'];

const through: Through = (path, init) =>
  app.request(path, { ...init, body: init.method === 'GET' || init.method === 'HEAD' ? undefined : '{"name":"x"}' }, env());

/** Every row in every table of APP_DB: an anonymous request may change none of them. */
const rowCount = () =>
  appDb
    .rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
    .reduce((n, t) => n + Number(appDb.rows(`SELECT COUNT(*) AS n FROM "${String(t.name)}"`)[0].n), 0);

describe('every route that is not public refuses a caller with no credential, through the real app', () => {
  it('derived from app.routes: everything but GET /v1/health answers 401, and nothing is written', async () => {
    const before = rowCount();
    expect(await anonymousNotRefused(app.routes, through, PUBLIC, MIN_GUARDED)).toEqual([]);
    expect(rowCount()).toBe(before);
  });

  it('…and so does `Authorization: Bearer invalid`, on every guarded endpoint', async () => {
    const before = rowCount();
    const guarded = mountedEndpoints(app.routes).filter(
      (e) => e.method !== 'OPTIONS' && !PUBLIC.some((p) => p.method === e.method && p.path === e.path),
    );
    expect(guarded.length).toBeGreaterThanOrEqual(MIN_GUARDED);
    const wrong: string[] = [];
    for (const e of guarded) {
      const res = await app.request(
        probePath(e.path),
        {
          method: e.method,
          headers: { Authorization: 'Bearer invalid', 'Content-Type': 'application/json' },
          body: e.method === 'GET' ? undefined : '{"name":"x"}',
        },
        env(),
      );
      if (res.status !== 401) wrong.push(`${e.method} ${e.path} answered ${res.status}`);
    }
    expect(wrong).toEqual([]);
    expect(rowCount()).toBe(before);
  });

  it('the removed GET /v1/renewals is not mounted (rv2-services-023)', () => {
    expect(mountedEndpoints(app.routes).some((e) => e.path.startsWith('/v1/renewals'))).toBe(false);
  });
});
