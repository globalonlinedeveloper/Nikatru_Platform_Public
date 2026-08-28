// ─────────────────────────────────────────────────────────────────────────────
// Worker entrypoint. Wires CORS, a public health check, public webhooks, and a
// Supabase-auth-protected /v1 API group.
//
//   PUBLIC   GET    /v1/health              — no auth (deploy verification)
//   PUBLIC   POST   /v1/webhooks/revenuecat — secret-authed, not user-authed
//   ES256    DELETE /v1/account             — erasure. ASYMMETRIC-ONLY (see below)
//   AUTH     *      /v1/subscriptions ...   — Supabase JWT required
//
// ── 🔴 TWO AUTH BOUNDARIES ON ONE WORKER, AND THE DIFFERENCE IS THE POINT ────
// `supabaseAuth` verifies ES256 against Supabase's public JWKS and, if that
// fails, falls back to an HS256 MAC using the shared `SUPABASE_JWT_SECRET`.
// `erasureAuth` does only the first, with the secret out of scope entirely.
//
// DELETE /v1/account is mounted behind `erasureAuth` and is NOT a member of the
// `api` group below, so no line in this file puts the shared secret in front of
// it. Deletion is irreversible: a symmetric secret is one leaked environment
// variable away from an unauthenticated remote wipe of any account, which is
// survivable for a subscriptions read and not for this. The route ALSO re-checks
// `tokenAssurance` itself, so moving this mount would produce a logged 403
// rather than a silent downgrade. See src/middleware/auth.ts and
// src/routes/account.ts.
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
import { reportWorkerError } from './lib/error-sink';
import { corsMiddleware } from './middleware/cors';
import { supabaseAuth, erasureAuth } from './middleware/auth';
import account from './routes/account';
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
// ── 🔴 `ok` IS A MEASUREMENT NOW, NOT A LITERAL ──────────────────────────────
// It used to be the constant `true`, so `post-deploy-smoke.mjs --require-ok`
// asserted something that could not fail. See the identical note on the same
// route in services/platform/src/index.ts, and src/lib/health.ts — a
// BYTE-IDENTICAL twin of platform's copy, held equal by
// services/platform/test/twinned-worker-modules.test.ts — for the three-state
// design, the per-isolate cache and why every reading carries its age.
//
// ⚠️ THE SHAPE IS BACKWARD-COMPATIBLE. `ok` is still a top-level boolean that is
// `true` when healthy, and HTTP is still 200 even when it is false — `judge()`
// in post-deploy-smoke.mjs treats a non-200 as RETRYABLE, so a 503 would make
// "deployed and unwell" indistinguishable from "not deployed yet", which is the
// one distinction `--require-ok` exists to draw.
//
// 🔴 A FINDING THIS CHANGE CANNOT FIX FROM HERE. GlitchTip monitor 11 asserts
// platform's body (`expectedBody: "\"ok\":true\"`), so platform's honest `ok`
// reaches a monitor. THIS Worker's monitor — id 2, `Subly API health` in
// tooling/monitor-register.json — asserts `expectedStatus: 200` and NO body. So
// an `ok:false` here still leaves that monitor green. The deploy smoke catches
// it; the 60-second monitor does not. Closing that needs an `expectedBody` on
// monitor 2, which is a change to tooling/monitor-register.json and to the live
// GlitchTip monitor — neither of them this Worker's source.
//
// ── WHY THESE THREE DEPENDENCIES ─────────────────────────────────────────────
//   APP_DB         Subly's own data. Every /v1/subscriptions and /v1/budget
//                  request reads it.
//   PLATFORM_DB    the shared entitlements DB this Worker also reads directly.
//   SUPABASE_JWKS  the document every ES256 verification rests on — and this
//                  Worker mounts DELETE /v1/account behind `erasureAuth`, which
//                  is ASYMMETRIC-ONLY with no secret fallback, so a broken JWKS
//                  takes erasure down completely rather than degrading it.
//
// JWKS_CACHE is deliberately NOT probed. It is a warm-start cache: `jose` fetches
// the JWKS itself, so a KV failure there costs latency on a cold isolate and
// nothing else (src/middleware/auth.ts says so in its header). Reporting it as a
// dependency would make the endpoint say `ok:false` for a fault no request can
// feel — and a health check that cries about something harmless is one somebody
// stops reading. What the cache is FOR is covered by `supabase_jwks` below.
//
// The reads are the cheapest that would DIFFER if the dependency were broken;
// each names a real table so a database that is reachable but carries no schema
// — the "wrong D1 bound" deploy failure — fails too, which a bare `SELECT 1`
// would not. No probe writes anything.
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
            c.env.APP_DB.prepare('SELECT 1 FROM subscriptions LIMIT 1').first(),
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
    build: c.env.RELEASE ?? null,
    time: nowIso(),
    checks: report.checks,
  });
});

// ── Public: webhooks (authenticated by shared secret, not by user JWT) ────────
app.route('/v1/webhooks', webhooks);

// ── ERASURE: the ONE route on this Worker behind the strict boundary ──────────
//
// ⚠️ REGISTERED BEFORE THE `api` GROUP, AND THAT ORDER IS LOAD-BEARING. Hono
// composes every handler whose path matches, in REGISTRATION order, and the
// group below registers `supabaseAuth` at `/v1/*` — which matches `/v1/account`
// too. Registering the erasure route first means its handler runs and returns
// before the permissive middleware is ever reached. That is a subtle thing to
// rest a security property on, which is exactly why it is NOT what the property
// rests on: the route re-checks `tokenAssurance` and refuses anything it did not
// get from `erasureAuth`, and test/erasure.test.ts drives the REAL Worker
// exported below — not a hand-built app — so the mounting itself is under test.
app.use('/v1/account', erasureAuth);
app.route('/v1', account);

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
