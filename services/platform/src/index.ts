// ─────────────────────────────────────────────────────────────────────────────
// platform Worker entrypoint. Public config chassis + a consolidated cron.
//   PUBLIC  GET    /v1/health   — deploy verification, no auth.
//   PUBLIC  GET    /config/:app — CFG-1 runtime config (KV-backed, edge-cached).
//   PUBLIC  POST   /v1/events   — first-party analytics ingest (G-12).
//   PUBLIC  POST   /v1/consent  — the DPDP consent artifact.
//   AUTHED  DELETE /v1/account  — erasure ([4]B-5). ES256/JWKS only.
//   CRON    0 6 * * *           — Supabase keep-alive + per-app renewals fan-out.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { nowIso } from './lib/d1';
import { corsMiddleware } from './middleware/cors';
import { platformAuth } from './middleware/auth';
import account from './routes/account';
import config from './routes/config';
import events from './routes/events';
import { scheduled } from './scheduled';

const app = new Hono<AppEnv>();

// Correlation id: stamp/propagate + echo.
app.use('*', async (c, next) => {
  const rid = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', rid);
  c.header('x-request-id', rid);
  await next();
});

app.use('*', corsMiddleware);

// Public health check — VERIFICATION ENDPOINT, must not require auth.
app.get('/v1/health', (c) =>
  c.json({
    ok: true,
    app: c.env.APP_ID,
    version: c.env.API_VERSION,
    time: nowIso(),
  }),
);

// Public: CFG-1 runtime config.
app.route('/config', config);

// Public: first-party analytics ingest + the DPDP consent artifact (G-12).
// Unauthenticated by design — the events are pseudonymous and the most valuable
// ones (first_launch, paywall_viewed) happen before any login exists.
app.route('/v1', events);

// AUTHENTICATED: erasure ([4]B-5). The ONLY route on this Worker behind
// `platformAuth`, and the reason that middleware is not a dead file.
//
// ⚠️ THE `use` MUST BE PATH-SCOPED, NOT `'*'`. A global auth middleware here
// would put a bearer-token requirement in front of GET /config/:app and
// POST /v1/events — the two routes that are unauthenticated BY DESIGN, because
// config resolution happens on every app's launch path and the most valuable
// analytics events (first_launch, paywall_viewed) happen before any login
// exists. Mounting order is the whole difference between "the shared server can
// authenticate" and "every app is locked out of its own config".
app.use('/v1/account', platformAuth);
app.route('/v1', account);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(`[unhandled] rid=${c.get('requestId') ?? '-'}`, err);
  return c.json({ error: 'internal_error' }, 500);
});

export default { fetch: app.fetch, scheduled };
