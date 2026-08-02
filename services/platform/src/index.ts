// ─────────────────────────────────────────────────────────────────────────────
// platform Worker entrypoint. Public config chassis + a consolidated cron.
//   PUBLIC  GET    /v1/health   — deploy verification, no auth.
//   PUBLIC  GET    /config/:app — CFG-1 runtime config (KV-backed, edge-cached).
//   PUBLIC  POST   /v1/events   — first-party analytics ingest (G-12).
//   PUBLIC  POST   /v1/consent  — the DPDP consent artifact.
//   AUTHED  DELETE /v1/account  — erasure ([4]B-5). ES256/JWKS only.
//   AUTHED  POST   /v1/plan/cancel — the ROSCA cancel path ([5]M-9).
//   SIGNED  POST   /v1/money/:provider — the merchant-of-record webhook ([5]M-1).
//                                  HMAC over the raw body; no user session.
//   CRON    0 6 * * *           — Supabase keep-alive + per-app renewals fan-out.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from './types';
import { nowIso } from './lib/d1';
import { reportWorkerError } from './lib/error-sink';
import { corsMiddleware } from './middleware/cors';
import { platformAuth } from './middleware/auth';
import account from './routes/account';
import config from './routes/config';
import entitlements from './routes/entitlements';
import events from './routes/events';
import cancellation from './routes/cancellation';
import money from './routes/money';
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

// The MONEY RAIL ([ADR 004], [ADR 020]:18). Mounted on the SHARED host on
// purpose: a per-app Worker must never see a webhook, so fifty stamped apps
// inherit one verified rail instead of fifty copies of a signature check.
//
// ⚠️ IT IS **NOT** BEHIND `platformAuth`, AND THAT IS DELIBERATE. The sender is a
// merchant of record, not a user — there is no Supabase session to present. Its
// authentication is an HMAC-SHA256 over the RAW BODY, which is strictly stronger
// than a bearer token for this purpose: a bearer secret proves the sender knows
// a string, while a signature proves THIS BODY came from the holder of that
// string. Mounted BEFORE the `/v1/account` auth `use` below so the path-scoped
// middleware cannot reach it. [pipeline 5]M-1
app.route('/v1/money', money);

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

// AUTHENTICATED: the shared entitlement read ([5]M-4). The other half of what
// [4]B-3's middleware lift was for — until this route existed, the only working
// entitlement read in the repo was inside services/subly-api, so every
// CLIENT-ONLY stamped app had no way to ask whether its user had paid.
// Path-scoped for the same reason as /v1/account above.
app.use('/v1/entitlements', platformAuth);
app.route('/v1', entitlements);

// AUTHENTICATED: the ROSCA cancel path ([5]M-9). Cancelling has to be a real
// server call the user can make from inside the app, not a support email — and
// the record it writes is the only evidence that they asked, in the window
// between pressing cancel and the merchant of record acting.
//
// Path-scoped like the two above, and the path is `/v1/plan/cancel`
// rather than something under `/v1/money`: `money` is mounted at `/v1/money`
// with a `/:provider` route, so a sibling there would be matched as a provider
// named "cancel" the moment somebody reordered the file.
app.use('/v1/plan/*', platformAuth);
app.route('/v1', cancellation);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
// [pipeline 11]E-8 — an unhandled error REACHES A SINK, not just the log.
// `console.error` alone produced exactly one artefact nobody sees: `wrangler
// tail` is a live stream, and Free keeps no searchable history. The report is
// handed to `waitUntil` so the caller's 500 is not held open behind GlitchTip,
// and `reportWorkerError` never rejects — see lib/error-sink.ts.
app.onError((err, c) => {
  console.error(`[unhandled] rid=${c.get('requestId') ?? '-'}`, err);
  const url = new URL(c.req.url);
  const report = reportWorkerError(
    err,
    {
      service: 'platform',
      release: c.env.RELEASE,
      requestId: c.get('requestId'),
      method: c.req.method,
      path: url.pathname, // pathname only — never the query string
    },
    c.env,
  );
  // `executionCtx` is absent when the app is invoked directly (unit tests), so
  // the await-less fallback keeps the handler working in both worlds rather
  // than throwing a second error while reporting the first.
  try {
    c.executionCtx.waitUntil(report);
  } catch {
    void report;
  }
  return c.json({ error: 'internal_error' }, 500);
});

export default { fetch: app.fetch, scheduled };
