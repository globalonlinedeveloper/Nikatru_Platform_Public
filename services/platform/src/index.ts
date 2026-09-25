// ─────────────────────────────────────────────────────────────────────────────
// platform Worker entrypoint. Public config chassis + a consolidated cron.
//   PUBLIC  GET    /v1/health   — deploy verification, no auth.
//   PUBLIC  GET    /config/:app — CFG-1 runtime config (KV-backed, edge-cached).
//   PUBLIC  POST   /v1/events   — first-party analytics ingest (G-12).
//   PUBLIC  POST   /v1/consent  — the DPDP consent artifact.
//   AUTHED  DELETE /v1/account  — erasure ([4]B-5). ES256/JWKS only.
//   AUTHED  POST   /v1/plan/cancel — the ROSCA cancel path ([5]M-9).
//   AUTHED  POST   /v1/report   — flag AI-generated content, in-app (G-39).
//   AUTHED  POST   /v1/checkout — the Paddle create-transaction half ([ADR 044]
//                                  rung 2). Dormant: 403 while the paywall is off.
//   AUTHED  POST   /v1/receipts/:store — the STORE RECEIPT pull (design 3.2).
//                                  A store purchase is verified against the
//                                  store's own API; the client's token is never
//                                  evidence on its own.
//   SIGNED  POST   /v1/money/:provider — the merchant-of-record webhook ([5]M-1).
//                                  HMAC over the raw body; no user session.
//   AUTHED  POST   /v1/ext/codes  — the extension account check: the signed-in
//                                  nikatru.com/ext/connect page mints a one-time code.
//   PUBLIC  POST   /v1/ext/token  — the extension exchanges that code (PKCE S256)
//                                  for its per-device credential. Edge-ceilinged.
//   DEVICE  POST   /v1/ext/revoke — a device credential revokes itself.
//   DEVICE  GET    /v1/entitlements — the ONE read route that also accepts the
//                                  device credential (ADR 059 D10); JWT otherwise.
//   CRON    0 6 * * *           — Supabase keep-alive + per-app renewals fan-out.
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
import { platformAuth } from './middleware/auth';
import { entitlementsAuth } from './middleware/ext-device-auth';
import providerToken from './routes/provider-token';
import account from './routes/account';
import config from './routes/config';
import entitlements from './routes/entitlements';
import ext from './routes/ext';
import events from './routes/events';
import cancellation from './routes/cancellation';
import report from './routes/report';
import checkout from './routes/checkout';
import money from './routes/money';
import receipts from './routes/receipts';
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
//
// 🔴 `build` IS A SEPARATE FIELD FROM `version`, AND OVERLOADING THEM WOULD BE
// THE BUG. `version` is `API_VERSION` — the literal "v1", a PUBLIC API-CONTRACT
// version that must not change when a commit ships. A build identity is the
// opposite: it changes on every deploy and is meaningless to a client. Until
// this line existed, the only thing `/v1/health` could say was "v1", so the
// post-deploy smoke had nothing to join a deploy to and "the Worker answered"
// was indistinguishable from "the OLD Worker answered". [pipeline 14]O-7.
//
// It is the same `RELEASE` var the crash sink already groups by, so a deploy
// cannot set one and not the other. NULL rather than absent when unset: a
// missing key and a key set to nothing read identically to a JSON consumer, and
// the smoke has to be able to say "this deploy did not thread its build id".
// ── 🔴 `ok` IS A MEASUREMENT NOW, NOT A LITERAL ──────────────────────────────
// It used to be the constant `true`. Two live probes rest on this one field —
// `post-deploy-smoke.mjs --require-ok` and GlitchTip monitor 11's `"ok":true`
// body assertion — and NEITHER COULD EVER FAIL, so `platform.nikatru.com` could
// have had PLATFORM_DB unreachable or the JWKS fetch dead and both stayed green.
// See src/lib/health.ts for the three-state design and the cache reasoning.
//
// ⚠️ NEITHER PROBE CHANGES. The shape is backward-compatible on purpose: `ok`
// is still a top-level boolean that is `true` when healthy, so `--require-ok`
// and the monitor's body match keep working unmodified. What changed is what
// makes it true, not what it looks like.
//
// ⚠️ IT ANSWERS HTTP 200 EVEN WHEN `ok` IS FALSE, AND THAT IS DELIBERATE. A 503
// would look identical to "the Worker is not up yet" to `judge()` in
// post-deploy-smoke.mjs, which treats every non-200 as RETRYABLE — collapsing
// the exact distinction `--require-ok` exists to draw. That script's own comment
// states it: "a Worker that answers with the right build and `ok:false` has
// deployed and is unwell, and collapsing the two would report a bad deploy as a
// good one." A 200 carrying `ok:false` keeps "which build is live" answerable at
// the moment it matters most.
//
// ── WHY THESE THREE DEPENDENCIES AND NOT OTHERS ──────────────────────────────
//   PLATFORM_DB    the shared entitlements DB. Every authenticated read and the
//                  whole analytics rail land here.
//   CONFIG_KV      GET /config/:app reads it UNGUARDED (routes/config.ts:52 —
//                  no try/catch), so a KV that refuses turns the FIRST request
//                  every launching app makes into a 500.
//   SUPABASE_JWKS  the document every ES256 verification rests on. When it
//                  fails, DELETE /v1/account 401s for everybody while the Worker
//                  itself is perfectly well — invisible to any status check.
//
// SUBSCRIPTIONTRACKER_DB is deliberately NOT probed: nothing on the request path touches it,
// only the nightly renewals fan-out does, and the cron's liveness is already
// carried by the `cron_heartbeat` table (migration 0003) rather than by a
// per-request probe. Probing it here would spend a D1 query on every health
// request to report on a code path no request can reach.
//
// The reads are the cheapest that would DIFFER if the dependency were broken.
// `SELECT 1 FROM entitlements LIMIT 1` reads at most one row and is preferred
// over a bare `SELECT 1` because it also fails when the WRONG database is bound
// — a database that exists but carries no schema answers `SELECT 1` perfectly,
// and "deployed against the wrong D1" is precisely a deploy failure this
// endpoint is smoked to catch. No probe writes ANYTHING: a health check that
// wrote would spend the 1,000-writes/day KV budget it exists to report on.
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
            c.env.PLATFORM_DB.prepare('SELECT 1 FROM entitlements LIMIT 1').first(),
          ),
      },
      {
        name: 'config_kv',
        ttlMs: READING_TTL_MS,
        // A `get` of a key that does not exist resolves `null` — a SUCCESSFUL
        // read, and the cheapest one KV offers. What is measured is whether the
        // namespace answered; no key is created and nothing is written.
        run: () =>
          probeBinding(c.env.CONFIG_KV, () => c.env.CONFIG_KV.get('health:probe')),
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
// ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE — A SECOND LINE, AND IT IS NOT
// REDUNDANT, for the same reason `/v1/entitlements/*` below is not: Hono matches
// `app.use('/v1/account', …)` on that path ALONE, so `PUT /v1/account/apple-token`
// would be reached with no `userId` set. That route writes a credential keyed by
// the caller's subject; unauthenticated it would key it by nothing.
// ⏱ 2026-09-24 · `PUT /v1/account/provider-token` (routes/provider-token.ts, which
// also serves the apple-token alias) sits under the same line for the same reason.
app.use('/v1/account/*', platformAuth);
app.route('/v1', account);
app.route('/v1', providerToken);

// AUTHENTICATED: the shared entitlement read ([5]M-4). The other half of what
// [4]B-3's middleware lift was for — until this route existed, the only working
// entitlement read in the repo was inside services/subscriptiontracker-api, so every
// CLIENT-ONLY stamped app had no way to ask whether its user had paid.
// Path-scoped for the same reason as /v1/account above.
//
// 🔴 HISTORY: THIS WAS TWO LINES, `app.use('/v1/entitlements', platformAuth)` and
// `app.use('/v1/entitlements/*', platformAuth)`. The second was added when
// `/v1/entitlements/subject` landed (2026-09-09, the bundle read) mounted OUTSIDE
// the first: the route existed, answered 200, and `c.get('userId')` was
// undefined for an anonymous caller. test/bundle-entitlements.test.ts asserts
// the 401 specifically, because a missing route also returns non-2xx.
//
// ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT — NOW ONE LINE, AND THE ONE
// LINE IS A MEASUREMENT. test/ext-auth.test.ts asked this app's real router:
// `/v1/entitlements/*` ALSO matches the exact path `/v1/entitlements` (hono
// 4.13.8), so the two lines both ran `platformAuth` there. A device-aware
// middleware on the exact path alone would have let the extension's credential
// through and then been 401'd by the `/*` line. So the whole tree now has ONE
// path-aware middleware: exactly `GET /v1/entitlements` with an `nkx1_` bearer
// goes to the device check, and EVERY other request in the tree — `/subject`
// and any sub-route added later — goes to `platformAuth`, JWT-only by default.
app.use('/v1/entitlements/*', entitlementsAuth);
app.route('/v1', entitlements);

// The extension account check (O-EXTENSION-ACCOUNT-CHECK-UNBUILT, design §3.4).
// 🔴 NO `app.use` HERE, DELIBERATELY: each route carries its own auth AT THE
// HANDLER (routes/ext.ts) — `/ext/codes` platformAuth, `/ext/revoke` the device
// credential, `/ext/token` none, behind EXT_TOKEN_CEILING_LIMITER — so no
// middleware can leak onto a sibling path the way `/v1/entitlements/subject`
// once went unauthenticated.
app.route('/v1', ext);

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

// AUTHENTICATED: the in-app AI-content report (O-PLAY-AI-CONTENT-REPORTING, G-39).
// Google Play requires a content app to let users flag offensive AI output to
// the developer WITHOUT LEAVING THE APP; routes/report.ts is where that lands.
// The reporter is the verified JWT subject — attributable, capped per person,
// and erased with the account. An exact path, so the bare form covers it.
app.use('/v1/report', platformAuth);
app.route('/v1', report);

// AUTHENTICATED: the Paddle create-transaction half ([ADR 044] rung 2).
//
// ⚠️ IT IS BEHIND `platformAuth` BECAUSE THE ACCOUNT ID IS THE WHOLE POINT. The
// transaction carries `custom_data.nikatru_user_id` so every subscription event
// that follows is attributable — [ADR 044] §6 files the defect where one was
// not — and a user id taken from a request body would let anyone attribute a
// purchase to anyone. It comes from the verified JWT and from nowhere else,
// exactly as on /v1/plan/cancel.
//
// Path-scoped like the three above. Mounted at `/v1/checkout` rather than under
// `/v1/money`, which is a `/:provider` route: a sibling there would be matched
// as a merchant of record named "checkout".
//
// 🔴 AND IT ANSWERS 403 FOR EVERY APP TODAY. `paywall.enabled` is false
// portfolio-wide and [T-11] (renewal notices for two 30-day trials) blocks the
// flip, so this route is wired and dormant on purpose — the overlay path
// (`Paddle.Checkout.open`) needs no server at all, which is [ADR 044] §5(2)'s
// finding and the reason this is rung 2 rather than the v1 dependency.
app.use('/v1/checkout', platformAuth);
app.route('/v1', checkout);

// AUTHENTICATED: the STORE RECEIPT rail (design §3.2).
//
// 🔴 IT EXISTS TO REMOVE THE ONE LEG THAT CANNOT BE REVERSED. On iOS and Android
// the purchase→unlock leg runs inside the client; a server that granted on the
// posted token would inherit that irreversibility and add a forgery surface. So
// the client posts an OPAQUE token, the server calls the store's own API, and
// only a verified server-side answer writes a grant. Google's RTDN carries no
// proof in its body and Microsoft has no push at all — the pull is mandatory, not
// an optimisation.
//
// ⚠️ BEHIND `platformAuth` BECAUSE THE SUBJECT IS THE POINT: the grant is written
// for the Supabase `sub` in the verified JWT and for no id that appeared in a
// body — the same reason /v1/checkout is authenticated ([ADR 044] §6).
//
// Path-scoped like the four above, and mounted at `/v1/receipts` rather than
// under `/v1/money`, which is a `/:provider` route: a sibling there would be
// matched as a merchant of record named "receipts".
app.use('/v1/receipts/*', platformAuth);
app.route('/v1', receipts);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
// [pipeline 11]E-8 — an unhandled error REACHES A SINK, not just the log.
// `console.error` alone produced exactly one artefact nobody sees: `wrangler
// tail` is a live stream, and Free keeps no searchable history. The report is
// handed to `waitUntil` so the caller's 500 is not held open behind GlitchTip,
// and `reportWorkerError` never rejects — see lib/error-sink.ts.
app.onError((err, c) => {
  // [pipeline B-16] THE LOG LINE NAMES THE APP AND THE RELEASE. It used to be
  // `rid=` and nothing else, which on the one Worker every app in the portfolio
  // shares meant an unhandled error could be read, correlated to a request —
  // and never attributed to a product. `-` where the request failed before an
  // app was named, deliberately: see `Variables.appId`.
  console.error(
    `[unhandled] rid=${c.get('requestId') ?? '-'} app=${c.get('appId') ?? '-'} release=${c.env.RELEASE ?? '-'}`,
    err,
  );
  const url = new URL(c.req.url);
  const report = reportWorkerError(
    err,
    {
      service: 'platform',
      release: c.env.RELEASE,
      appId: c.get('appId'),
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

// ⏱ 2026-09-22 — THE ROUTE TABLE, FOR THE TEST THAT MUST NOT DRIFT FROM IT.
// test/cors.test.ts reads `app.routes` and preflights every mounted route with
// its own method, so the CORS method list is checked against what this file
// actually mounts — not against a second hand-kept list that can go stale the
// way `GET, POST, DELETE, OPTIONS` did while `PUT /v1/account/apple-token` was
// live. The default export above is still the only thing the runtime serves;
// a bundle with this export was loaded in workerd and answered its preflight.
export { app };
