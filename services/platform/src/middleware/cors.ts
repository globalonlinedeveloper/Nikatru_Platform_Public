// CORS for the SHARED platform Worker: this file binds a policy and implements
// nothing. The one middleware is services/_shared/src/cors.ts.
//
// Scope `every-app` (tooling/platform-register.json `servingWorker.cors`): since
// [ADR 020] a client-only stamped app has no Worker of its own and calls this
// host for config, analytics, entitlements and account deletion, so every app's
// web origin is on this Worker's exact list and localhost is not.
//
// ⚠️ THE OPERATIONAL COST IS REAL — every new app's web origin must be added to
// `ALLOWED_ORIGINS` in this Worker's wrangler.jsonc and redeployed, or that app
// silently loses config resolution and analytics in the browser. The owner chose
// the explicit list over suffix-matching `*.nikatru.com`, so the redeploy is the
// accepted trade.
//
// `methods` is what the MOUNTED routes answer: GET, POST, PUT, DELETE. No platform
// route answers PATCH, so PATCH is not offered. ⏱ 2026-09-22, one method over:
// `PUT /v1/account/apple-token` was live while this list read `GET, POST, DELETE,
// OPTIONS`, and every web sign-in with Apple was refused at preflight.
// test/cors.test.ts now reads the real route table and preflights every mounted
// route with its own method, and holds this list to exactly what they answer.
import { cors } from '../../../_shared/src/cors';

export * from '../../../_shared/src/cors';

// ⏱ 2026-09-28 · ST-N1: `refuseBrowsersOn` names the captcha-free native sign-in
// (routes/native-auth.ts, POST /v1/auth/native/<app>/<op>). Every browser request
// there, and every preflight, is a 403 with no CORS header; services/_shared/src/cors.ts
// says why. test/cors.test.ts declares those endpoints no-CORS, with the reason.
// ⏱ 2026-10-01 · PB-27: `/v1/ops/` too — POST /v1/ops/box-manifest is a box's
// cron reporting config hashes (routes/box-manifest.ts); no browser calls it.
export const corsMiddleware = cors({
  scope: 'every-app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  refuseBrowsersOn: ['/v1/auth/native/', '/v1/ops/'],
});
