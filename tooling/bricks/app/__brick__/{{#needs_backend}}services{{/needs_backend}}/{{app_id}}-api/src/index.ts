// ─────────────────────────────────────────────────────────────────────────────
// Worker entrypoint for {{app_id}}-api. Wires CORS, a public health check, and a
// Supabase-JWT-protected /v1 API group (incl. G2 account deletion).
//   PUBLIC  GET    /v1/health   — deploy verification, no auth.
//   AUTH    DELETE /v1/account  — G2 in-app account deletion.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { nowIso } from './lib/d1';
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

// Public health check — VERIFICATION ENDPOINT, must not require auth.
app.get('/v1/health', (c) =>
  c.json({
    ok: true,
    app: c.env.APP_ID,
    version: c.env.API_VERSION,
    time: nowIso(),
  }),
);

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
