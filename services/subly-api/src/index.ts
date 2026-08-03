// ─────────────────────────────────────────────────────────────────────────────
// Worker entrypoint. Wires CORS, a public health check, public webhooks, and a
// Supabase-auth-protected /v1 API group.
//
//   PUBLIC   GET  /v1/health              — no auth (deploy verification)
//   PUBLIC   POST /v1/webhooks/revenuecat — secret-authed, not user-authed
//   AUTH     *    /v1/subscriptions ...    — Supabase JWT required
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv } from './types';
import { nowIso } from './lib/d1';
import { reportWorkerError } from './lib/error-sink';
import { corsMiddleware } from './middleware/cors';
import { supabaseAuth } from './middleware/auth';
import subscriptions from './routes/subscriptions';
import renewals from './routes/renewals';
import budget from './routes/budget';
import entitlements from './routes/entitlements';
import webhooks from './routes/webhooks';

const app = new Hono<AppEnv>();

// ── Request id: stamp/propagate a correlation id, echo it, log it on errors ───
app.use('*', async (c, next) => {
  const rid = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', rid);
  c.header('x-request-id', rid);
  await next();
});

app.use('*', corsMiddleware);

// ── Public: health check (VERIFICATION ENDPOINT — must not require auth) ──────
// 🔴 `build` IS A SEPARATE FIELD FROM `version` — see the note on the same route
// in services/platform/src/index.ts. `version` is the literal "v1" API-contract
// version; `build` is the commit this Worker was deployed from, and it is what
// the post-deploy smoke joins a deploy to. Without it, "the Worker answered" and
// "the OLD Worker answered" are the same observation. [pipeline 14]O-7.
app.get('/v1/health', (c) =>
  c.json({
    ok: true,
    app: c.env.APP_ID,
    version: c.env.API_VERSION,
    build: c.env.RELEASE ?? null,
    time: nowIso(),
  }),
);

// ── Public: webhooks (authenticated by shared secret, not by user JWT) ────────
app.route('/v1/webhooks', webhooks);

// ── Protected: everything else under /v1 requires a valid Supabase JWT ────────
const api = new Hono<AppEnv>();
api.use('*', supabaseAuth);
api.route('/subscriptions', subscriptions);
api.route('/renewals', renewals);
api.route('/budget', budget);
api.route('/entitlements', entitlements);
app.route('/v1', api);

// Fallback 404 as JSON to keep the error contract consistent.
app.notFound((c) => c.json({ error: 'not_found' }, 404));
// [pipeline 11]E-8 — an unhandled error REACHES A SINK, not just the log. See
// lib/error-sink.ts; the report is handed to `waitUntil` so the caller's 500 is
// not held open behind GlitchTip, and it never rejects.
app.onError((err, c) => {
  console.error(`[unhandled] rid=${c.get('requestId') ?? '-'}`, err);
  const url = new URL(c.req.url);
  const report = reportWorkerError(
    err,
    {
      service: 'subly-api',
      release: c.env.RELEASE,
      requestId: c.get('requestId'),
      method: c.req.method,
      path: url.pathname, // pathname only — never the query string
    },
    c.env,
  );
  try {
    c.executionCtx.waitUntil(report);
  } catch {
    void report;
  }
  return c.json({ error: 'internal_error' }, 500);
});

export default { fetch: app.fetch };
