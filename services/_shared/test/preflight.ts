// ─────────────────────────────────────────────────────────────────────────────
// preflight.ts — the CORS method list, checked against the routes a Worker
// REALLY mounts, imported by every Worker suite that sets
// `Access-Control-Allow-Methods`.
//
// 🔴 THE DEFECT THIS EXISTS FOR, TWICE. ⏱ 2026-09-22. services/platform answered
// preflights with `GET, POST, DELETE, OPTIONS` while `PUT /v1/account/apple-token`
// was live, so a browser never sent the PUT, the Apple refresh token never
// reached the server, and the revoke-on-delete path had nothing to revoke. The
// same thing had already happened once in services/subscriptiontracker-api with
// `PUT /v1/budget`. Both times the Worker's own cors test was green, because it
// asserted a HAND-TYPED list of methods — the list the author remembered, not
// the list the routes needed. A route mounted with a new method never made that
// test fail.
//
// THE SEAM, AND WHY IT CANNOT DRIFT. Each Worker's `src/index.ts` exports its
// Hono `app` beside the default export, and Hono's `app.routes` is the table the
// router is built from — the same entries a request is matched against, with
// every `app.route(prefix, sub)` already merged in. So the methods below are not
// a second list somebody keeps in step; they ARE the mounting. Each test then
// sends a real preflight to each mounted path, naming that route's own method in
// `Access-Control-Request-Method`, through the real middleware stack, and reads
// the answer the browser would read. Rejected alternatives: globbing
// `src/routes/*.ts` (misses routes declared inline in index.ts, and cannot see a
// sub-app that is never mounted), and mocking `hono` to capture instances
// (guesses which instance is the root).
//
// ⚠️ NO IMPORTS, ON PURPOSE. A bare import here resolves for nobody (see
// shared-home.test.ts) and a relative one would tie this to one Worker. The route
// table is typed structurally; each caller passes its own `app.routes` and a
// function that issues the request through its own `app`.
// ─────────────────────────────────────────────────────────────────────────────

/** One entry of a Hono app's `routes` table, typed structurally. */
export interface MountedRoute {
  readonly method: string;
  readonly path: string;
  readonly handler: { readonly length: number };
}

/** A method and the path it is mounted on. */
export interface Endpoint {
  readonly method: string;
  readonly path: string;
}

/** Hono registers both `app.use(...)` and `app.all(...)` under this method. */
const ALL = 'ALL';

/**
 * Every (method, path) the app answers, middleware excluded, de-duplicated.
 *
 * An `ALL` entry whose handler takes `(c, next)` is middleware (`app.use`, or a
 * sub-app's `use` merged in by `app.route`) and answers nothing by itself. An
 * `ALL` entry with a one-argument handler is an ENDPOINT that answers every
 * method, and the list cannot be derived from it — so it is refused loudly
 * rather than skipped, because skipping it is how a route escapes the check.
 */
export function mountedEndpoints(routes: ReadonlyArray<MountedRoute>): Endpoint[] {
  const out: Endpoint[] = [];
  const seen = new Set<string>();
  for (const r of routes) {
    const method = r.method.toUpperCase();
    if (method === ALL) {
      if (r.handler.length >= 2) continue;
      throw new Error(
        `${r.path} is mounted for ALL methods with a handler that takes no \`next\`, i.e. an endpoint ` +
          'that answers every method. The preflight list cannot be derived from it: mount it per method.',
      );
    }
    const key = `${method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method, path: r.path });
  }
  return out;
}

/** A concrete path for a route pattern: each `:param` (with or without a
 *  `{regex}` or `?`) and each `*` becomes a literal segment. */
export function probePath(pattern: string): string {
  return pattern.replace(/:[A-Za-z0-9_]+(\{[^}]*\})?\??/g, 'x').replace(/\*/g, 'x');
}

/** The methods a header value names, as exact upper-case tokens — never a
 *  substring match, under which `PATCH` would be found inside `XPATCHY`. */
export function allowedMethods(header: string | null): string[] {
  return (header ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** Issue one request through the Worker's own app (for Hono: `app.request`). */
export type RequestThroughApp = (
  path: string,
  init: { method: string; headers: Record<string, string> },
) => Response | Promise<Response>;

/**
 * Preflights every endpoint with its own method, from `origin`, and returns one
 * line per refusal — an empty array is the pass. A refusal is anything a browser
 * would not proceed on: a status other than 204, an `Access-Control-Allow-Origin`
 * that is not the caller's origin, or an `Access-Control-Allow-Methods` that does
 * not name the method.
 */
export async function refusedPreflights(
  request: RequestThroughApp,
  endpoints: ReadonlyArray<Endpoint>,
  origin: string,
): Promise<string[]> {
  const refused: string[] = [];
  for (const e of endpoints) {
    const res = await request(probePath(e.path), {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': e.method },
    });
    const allowMethods = res.headers.get('Access-Control-Allow-Methods');
    const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
    if (res.status !== 204 || allowOrigin !== origin || !allowedMethods(allowMethods).includes(e.method)) {
      refused.push(
        `${e.method} ${e.path} -> ${res.status}, allow-origin=${allowOrigin ?? '(none)'}, ` +
          `allow-methods=${allowMethods ?? '(none)'}`,
      );
    }
  }
  return refused;
}

/** Methods the header offers that no mounted route answers (`OPTIONS` aside,
 *  which is the preflight itself). */
export function unansweredMethods(header: string | null, endpoints: ReadonlyArray<Endpoint>): string[] {
  const answered = new Set(endpoints.map((e) => e.method));
  return allowedMethods(header).filter((m) => m !== 'OPTIONS' && !answered.has(m));
}
