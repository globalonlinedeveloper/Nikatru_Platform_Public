import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import type { AppEnv } from '../src/types';
import {
  mountedEndpoints,
  refusedPreflights,
  type RequestThroughApp,
} from '../../_shared/test/preflight';

// ─────────────────────────────────────────────────────────────────────────────
// cors.test.ts — EVERY ROUTE THIS APP MOUNTS IS PREFLIGHT-APPROVED FOR ITS OWN
// METHOD, and the list of routes is read from the app, not typed here.
//
// 🔴 ⏱ 2026-09-22. Both live Workers shipped a route whose method their CORS list
// did not offer — `PUT /v1/budget` in subscriptiontracker-api, then
// `PUT /v1/account/apple-token` in the shared platform Worker — and both times the
// Worker's cors test was green, because it looped over a HAND-TYPED list of
// methods. A browser refuses such a route at preflight, before the request is
// made, so the failure presents as a browser bug on a route whose own tests pass.
//
// This app will grow routes the template has never heard of. So the methods come
// from `app.routes` — the table Hono's router is built from, with every
// `app.route(prefix, sub)` merged in — and each route is preflighted on its own
// path through the real middleware stack. See services/_shared/test/preflight.ts.
//
// ⚬ AT LEAST, NOT EXACTLY. src/middleware/cors.ts offers GET, POST, PUT, PATCH and
// DELETE while the template itself mounts only GET and DELETE: the list is broad
// on purpose, so the first routes an app adds are not refused. An app that wants
// the list trimmed to what it mounts can add the exact check the shared platform
// Worker's suite carries (`unansweredMethods`).
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = 'https://app.example.test';
const endpoints = mountedEndpoints(app.routes);
const env = { ALLOWED_ORIGINS: ORIGIN } as AppEnv['Bindings'];
const through: RequestThroughApp = (path, init) => app.request(path, init, env);

describe('preflight allows every method a MOUNTED route answers', () => {
  it('reads a real route table, including the sub-app mounted at /v1/account', () => {
    // Not a tautology: an empty or middleware-only table would make the next
    // test pass vacuously.
    expect(endpoints).toContainEqual({ method: 'GET', path: '/v1/health' });
    expect(endpoints).toContainEqual({ method: 'DELETE', path: '/v1/account' });
  });

  it('every mounted route is preflight-approved for its own method, from a listed origin', async () => {
    expect(await refusedPreflights(through, endpoints, ORIGIN)).toEqual([]);
  });

  it('an origin that is not listed gets no approval', async () => {
    const res = await through('/v1/account', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'DELETE' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
