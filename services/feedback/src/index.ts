// ─────────────────────────────────────────────────────────────────────────────
// Worker entrypoint for `feedback` — the private "Report a problem" intake every
// app, site and extension posts to (lane feedback-intake, O-FEEDBACK-INTAKE-UNBUILT).
// Stamped from the brick's Worker (tooling/kit/stamp-service.mjs) and cut down to
// what an intake needs: no APP_DB of its own (the reports live in platform_db,
// migrated by services/platform/migrations/0025_feedback.sql), so no erasure
// route either — the platform's schema-derived erasure walk deletes a person's
// reports, and this Worker's cron deletes the screenshots they pointed at.
//   PUBLIC  GET  /v1/health    — deploy verification, no auth.
//   OPEN    POST /v1/feedback  — authed (session token) or anonymous (stricter).
// NOTHING ELSE IS MOUNTED: no route reads a report or a screenshot. The read path
// is the `FeedbackInternal` entrypoint (src/internal.ts), over a Service Binding.
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
import { requestId } from './lib/request-id';
import feedback from './routes/feedback';
import { runFeedbackCron } from './scheduled';

const app = new Hono<AppEnv>();

// Correlation id: stamp/propagate + echo. The caller's id is kept only when it is
// a plain token (services/_shared/src/request-id.ts); anything else is replaced.
app.use('*', requestId);

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
//   platform_db    the APAC database the reports are written to; the read names
//                  `feedback_reports`, so a platform_db that has not been migrated
//                  to 0025 is unhealthy, not "reachable".
//   screenshots    the private bucket; a HEAD of a key that never exists, so the
//                  probe proves the binding answers without reading any report.
//   supabase_jwks  the document the authed path's ES256 verification rests on.
//
// `build` is `c.env.RELEASE`, the commit deploy-workers.yml passes, which the
// deploy smoke joins on (`--field build`). No probe writes anything.
const probeCache = newProbeCache();

app.get('/v1/health', async (c) => {
  const now = Date.now();
  const report = await inspect(
    probeCache,
    [
      {
        name: 'platform_db',
        ttlMs: READING_TTL_MS,
        run: () =>
          probeBinding(c.env.PLATFORM_DB, () =>
            c.env.PLATFORM_DB.prepare('SELECT 1 FROM feedback_reports LIMIT 1').first(),
          ),
      },
      {
        name: 'screenshots',
        ttlMs: READING_TTL_MS,
        run: () => probeBinding(c.env.SCREENSHOTS, () => c.env.SCREENSHOTS.head('shots/.probe')),
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

// The intake. Its auth is per request (authed or anonymous, routes/feedback.ts),
// so no group middleware stands in front of it.
app.route('/v1/feedback', feedback);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

// ── [pipeline 11]E-8 — AN UNHANDLED ERROR REACHES A SINK, NOT JUST THE LOG ───
//
// 🔴 THIS HANDLER ONLY CALLED `console.error` UNTIL 2026-09-08, and a stamped
// backend inherited that. On a Worker, `console.error` goes to a `wrangler tail`
// stream nobody is watching, with no searchable history behind it — the error is
// invisible the moment it happens. Both live Workers were fixed and the template
// every future backend is stamped from was not, so
// `tooling/ci/assert-worker-error-sink.mjs` — whose subject is every
// `services/*/src/index.ts` — would have failed the generated repository on its
// first CI run.
//
// The report is handed to `waitUntil` so the caller's 500 is not held open
// behind GlitchTip, and `reportWorkerError` never rejects (it fails OPEN: an
// unset `GLITCHTIP_DSN` means no report, silently). `release` is
// `c.env.RELEASE` — the deployed SHA — and never `API_VERSION`, which is the
// literal "v1" and would group every error this app ever reports into one
// bucket named after a URL prefix.
//
app.onError((err, c) => {
  console.error(`[unhandled] rid=${c.get('requestId') ?? '-'}`, err);
  const url = new URL(c.req.url);
  const report = reportWorkerError(
    err,
    {
      service: 'feedback',
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

export default {
  fetch: app.fetch,
  // The nightly purge, orphan sweep and window prune (src/scheduled.ts).
  async scheduled(_event: unknown, env: AppEnv['Bindings'], ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runFeedbackCron(env));
  },
};

// The one read path: a named entrypoint, reached only over a Service Binding.
export { FeedbackInternal } from './internal';

// ⏱ 2026-09-22 — THE ROUTE TABLE, FOR THE TEST THAT MUST NOT DRIFT FROM IT.
// test/cors.test.ts reads `app.routes` and preflights every route this app
// mounts with its own method, so a route added with a method the CORS list does
// not offer is red in this app's own suite, not refused in a browser. The
// default export is still the only thing the runtime serves.
export { app };
