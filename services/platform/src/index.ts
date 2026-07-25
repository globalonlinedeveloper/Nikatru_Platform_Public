// ─────────────────────────────────────────────────────────────────────────────
// platform Worker entrypoint. Public config chassis + a consolidated cron.
//   PUBLIC  GET /v1/health     — deploy verification, no auth.
//   PUBLIC  GET /config/:app   — CFG-1 runtime config (KV-backed, edge-cached).
//   CRON    0 6 * * *          — Supabase keep-alive + per-app renewals fan-out.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { nowIso } from './lib/d1';
import { corsMiddleware } from './middleware/cors';
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

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(`[unhandled] rid=${c.get('requestId') ?? '-'}`, err);
  return c.json({ error: 'internal_error' }, 500);
});

export default { fetch: app.fetch, scheduled };
