// CORS for this app's own Worker: this file binds a policy and implements
// nothing. The one middleware is services/_shared/src/cors.ts — a fork HERE would
// not be one bad app, it would be every app the factory ever stamps, born wrong.
//
// Scope `own-app`: provision-backend.mjs step [6] writes `cors: "own-app"` into
// this Worker's tooling/platform-register.json row, and assert-cors-allowlist.mjs
// fails the build if the two disagree. The exact `ALLOWED_ORIGINS` list, plus any
// localhost port (the recorded per-app trade for the `flutter drive -d
// web-server` harness). An empty list denies every other browser origin: put this
// app's web origin in wrangler.jsonc `vars.ALLOWED_ORIGINS` (the post_gen
// checklist prints the step). The guard derives each Worker's required origins
// from catalog/apps.json, so no guard needs editing for a new app.
//
// `methods` is broad on purpose, so the first routes an app adds are not refused
// at preflight; test/cors.test.ts preflights every mounted route with its own
// method.
import { cors } from '../../../_shared/src/cors';

export * from '../../../_shared/src/cors';

export const corsMiddleware = cors({
  scope: 'own-app',
  appId: '{{app_id}}',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
