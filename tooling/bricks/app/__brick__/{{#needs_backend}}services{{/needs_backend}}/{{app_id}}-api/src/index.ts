// ─────────────────────────────────────────────────────────────────────────────
// Worker entrypoint for {{app_id}}-api. Wires CORS, a public health check, and a
// Supabase-JWT-protected /v1 API group (incl. G2 account deletion).
//   PUBLIC  GET    /v1/health   — deploy verification, no auth.
//   AUTH    DELETE /v1/account  — G2 in-app account deletion.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { nowIso } from './lib/d1';
import {
  inspect,
  newProbeCache,
  probeBinding,
  probeJwks,
  JWKS_READING_TTL_MS,
  READING_TTL_MS,
} from './lib/health';
import { corsMiddleware } from './middleware/cors';
import { supabaseAuth } from './middleware/auth';
import account from './routes/account';

const app = new Hono<AppEnv>();

// Correlation id: stamp/propagate + echo.
app.use('*', async (c, next) => {
  const rid = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', rid);
  c.header('x-request-id', rid);
  await next();
});

app.use('*', corsMiddleware);

// ── Public health check — VERIFICATION ENDPOINT, must not require auth ───────
//
// 🔴 `ok` IS A MEASUREMENT, NOT A LITERAL. This route used to return the constant
// `true`, so `tooling/ops/post-deploy-smoke.mjs --require-ok` and a GlitchTip
// body assertion on `"ok":true` were checks that could not fail — a stamped app
// was born with them. src/lib/health.ts carries the three-state design, the
// per-isolate cache and why every reading carries its `ageMs`.
//
// ⚠️ HTTP STAYS 200 WHEN `ok` IS FALSE. `judge()` in post-deploy-smoke.mjs treats
// a non-200 as RETRYABLE, so a 503 here would make "deployed and unwell" look
// like "not deployed yet" — the one distinction `--require-ok` exists to draw.
//
// ── WHY THESE THREE DEPENDENCIES, AND ONLY THESE ─────────────────────────────
//   app_db         this app's own D1. Every user-owned row lives here.
//   platform_db    the SHARED entitlements database `DELETE /v1/account` purges
//                  from — and that route swallows a failure there, so a broken
//                  read leaves entitlements behind on a deletion the user was
//                  told succeeded, with nothing else to report it.
//   supabase_jwks  the document every ES256 verification in middleware/auth.ts
//                  rests on; when it is unreachable every authenticated route
//                  401s while the Worker itself is perfectly well.
//
// JWKS_CACHE is deliberately NOT probed. middleware/auth.ts warms it best-effort
// and `jose` fetches the JWKS itself, so a KV failure there costs latency on a
// cold isolate and nothing else. Reporting it would say `ok:false` for a fault no
// request can feel, and a check that cries about something harmless is one people
// stop reading.
//
// Each read names a REAL TABLE rather than `SELECT 1`, so a database that is
// reachable but carries no schema — the "wrong D1 bound" deploy — fails too. No
// probe writes anything. EXTEND `app_db` if `records` is renamed away.
const probeCache = newProbeCache();

app.get('/v1/health', async (c) => {
  const now = Date.now();
  const report = await inspect(
    probeCache,
    [
      {
        name: 'app_db',
        ttlMs: READING_TTL_MS,
        run: () =>
          probeBinding(c.env.APP_DB, () =>
            c.env.APP_DB.prepare('SELECT 1 FROM records LIMIT 1').first(),
          ),
      },
      {
        name: 'platform_db',
        ttlMs: READING_TTL_MS,
        run: () =>
          probeBinding(c.env.PLATFORM_DB, () =>
            c.env.PLATFORM_DB.prepare('SELECT 1 FROM entitlements LIMIT 1').first(),
          ),
      },
      {
        name: 'supabase_jwks',
        ttlMs: JWKS_READING_TTL_MS,
        run: () => probeJwks(c.env.SUPABASE_URL),
      },
    ],
    now,
  );
  return c.json({
    ok: report.ok,
    status: report.status,
    app: c.env.APP_ID,
    version: c.env.API_VERSION,
    time: nowIso(),
    checks: report.checks,
  });
});

// Protected: everything else under /v1 requires a valid Supabase JWT.
const api = new Hono<AppEnv>();
api.use('*', supabaseAuth);
api.route('/account', account);
app.route('/v1', api);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(`[unhandled] rid=${c.get('requestId') ?? '-'}`, err);
  return c.json({ error: 'internal_error' }, 500);
});

export default { fetch: app.fetch };
