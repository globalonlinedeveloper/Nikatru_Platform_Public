// CORS for app #1's own Worker: this file binds a policy and implements nothing.
// The one middleware is services/_shared/src/cors.ts.
//
// Scope `own-app` (tooling/platform-register.json, this Worker's `appWorkers[].cors`):
// the exact `ALLOWED_ORIGINS` list, plus any localhost port — the recorded per-app
// trade for the `flutter drive -d web-server` harness (INC13), explained in the
// shared module's header.
//
// `methods`: PUT was missing while `PUT /v1/budget` was live, so a browser
// preflight for the budget save was rejected before the request was made — a
// config bug that presents as a browser bug. PATCH is here for
// `PATCH /v1/subscriptions/:id`. test/cors.test.ts reads the real route table and
// preflights every mounted route with its own method.
import { cors } from '../../../_shared/src/cors';

export * from '../../../_shared/src/cors';

export const corsMiddleware = cors({
  scope: 'own-app',
  appId: 'subscriptiontracker',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
