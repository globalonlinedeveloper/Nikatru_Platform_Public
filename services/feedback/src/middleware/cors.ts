// CORS for the feedback intake: this file binds a policy and implements nothing.
// The one middleware is services/_shared/src/cors.ts.
//
// Scope `every-app`: the exact `ALLOWED_ORIGINS` list and nothing else (no
// localhost). Every app's web build is served from the apex since [ADR 075], so
// the list is `https://nikatru.com`; the nikatru.com support form posts SAME-ORIGIN
// to its Pages Function, which forwards over a Service Binding and sends no Origin
// here at all. tooling/platform-register.json's row says `cors: "every-app"` and
// assert-cors-allowlist.mjs fails the build if the two disagree.
import { cors } from '../../../_shared/src/cors';

export * from '../../../_shared/src/cors';

export const corsMiddleware = cors({
  scope: 'every-app',
  methods: ['GET', 'POST', 'OPTIONS'],
});
