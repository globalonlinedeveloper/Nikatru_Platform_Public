// ─────────────────────────────────────────────────────────────────────────────
// cors.ts — THE ONE CORS MIDDLEWARE. Every Worker binds it with its own policy;
// none carries an implementation of its own (O-SERVICE-KIT-UNBUILT, E-b1).
//
// 🔴 THERE WERE THREE. services/platform hand-wrote a middleware,
// services/subscriptiontracker-api delegated to `hono/cors`, and the brick's
// stamped Worker hand-wrote a third that took the platform's mechanism and the
// app's policy. They agreed on the rule that matters (an exact list, fail closed)
// and differed on five behaviours nobody had decided: what a caller with no
// `Origin` gets, whether `x-request-id` is an allowed request header, a 24 h
// `Access-Control-Max-Age`, which Allow-* headers ride a non-preflight response,
// and when `Vary: Origin` is sent. The lead ruled them on 2026-09-26 (rv-c15 §3):
//   · the platform's mechanism is the shared one — two of the three already had
//     it, and the brick is what every future Worker is stamped with;
//   · no `Access-Control-Max-Age` anywhere — a cache knob, tested by nobody;
//   · the METHODS stay each Worker's (a fact about its mounted routes, not a
//     policy), passed in by the Worker and proven by its own test/cors.test.ts.
//
// ── ORIGIN POLICY: an EXACT allowlist (owner decision 2026-07-25) ────────────
// `ALLOWED_ORIGINS` is a comma-separated list of exact browser origins. Nothing
// is pattern-matched and nothing is inferred: an origin is either on the list or
// it gets no CORS headers, and the browser blocks it.
//
// ⚠️ AN EMPTY OR ABSENT LIST DENIES EVERY BROWSER ORIGIN (localhost aside, for an
// `own-app` Worker) — it does NOT fall back to `*`. It used to, in two of the
// three copies, and emptying that var turned a live user-data API into an
// answer-everyone API with CI fully green. tooling/ci/assert-cors-allowlist.mjs
// holds every services/*/wrangler.jsonc list to the app catalogue.
//
// WHICH ORIGINS A WORKER ANSWERS IS ITS `scope`, and the scope is recorded in
// tooling/platform-register.json (`servingWorker.cors`, `appWorkers[].cors`).
// assert-cors-allowlist.mjs reads it there, and fails a Worker whose binding in
// src/middleware/cors.ts passes a different one.
//
// LOCALHOST IS A RECORDED EXCEPTION, NOT AN OVERSIGHT. Localhost origins (any
// port, http or https) are allowed on top of the list for an `own-app` Worker,
// because `flutter drive -d web-server` serves the app on
// http://localhost:<random-port> and the CI integration_test harness cannot name
// its own port in advance (the INC13 fix). A localhost page still needs a valid
// Bearer token to read anything. It is a PER-APP trade: the shared platform
// Worker deliberately does not carry it.
//
// WHAT THIS DOES AND DOES NOT BUY: CORS is not a security boundary here. The
// platform's `/v1/events` and `/v1/consent` are unauthenticated by design and
// anyone can POST to them from curl; every data route is Bearer-gated. The
// allowlist is hygiene ([ADR 020]): it keeps a write-capable host from
// advertising `Access-Control-Allow-Origin: *` to browsers. Never let it stand in
// for auth on a new route.
//
// ⚠️ NO BARE IMPORT, so no `hono` type here (services/_shared/test/
// shared-home.test.ts says why). The middleware is typed by the few members of
// the request context it touches, which Hono's `Context` satisfies.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which browser origins a Worker answers.
 *
 * `every-app` — the shared Worker every app's web build calls: the exact list
 *               and nothing else.
 * `own-app`   — one app's own Worker: the exact list, plus localhost (the
 *               recorded per-app trade in the header).
 */
export type CorsScope = 'every-app' | 'own-app';

export interface CorsPolicy {
  /** Must equal this Worker's `cors` field in tooling/platform-register.json. */
  readonly scope: CorsScope;
  /** The app an `own-app` Worker belongs to. It decides nothing at runtime: since
   *  [ADR 075] every app's tab sends the same Origin, so the app is the bearer
   *  token's and `APP_ID`'s to tell. assert-cors-allowlist.mjs holds it to the
   *  Worker's `<appId>-api` directory. */
  readonly appId?: string;
  /** Every method this Worker's MOUNTED routes answer, plus OPTIONS. Each
   *  Worker's test/cors.test.ts derives the mounted set from the real route
   *  table and preflights every route, so a method missing here is red there. */
  readonly methods: readonly string[];
}

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const ALLOW_HEADERS = 'Authorization, Content-Type, x-request-id';

/** Exact origins, parsed from the comma-separated `ALLOWED_ORIGINS` var. */
export function allowlist(allowedOrigins: string | undefined): string[] {
  return (allowedOrigins ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The origin decision for a browser caller: on the list, or localhost for an
 * `own-app` Worker, or nothing. Never `*`. Without a scope it is the stricter
 * one, `every-app`.
 */
export function resolveOrigin(
  origin: string,
  list: string[],
  scope: CorsScope = 'every-app',
): string | null {
  if (list.includes(origin)) return origin;
  if (scope === 'own-app' && LOCALHOST.test(origin)) return origin; // the recorded per-app trade
  return null; // FAIL CLOSED
}

/** The members of Hono's request context this middleware uses, and no more. */
export interface CorsContext {
  readonly req: { header(name: string): string | undefined; readonly method: string };
  readonly env: { readonly ALLOWED_ORIGINS?: string };
  header(name: string, value: string): void;
  body(data: null, status: 204): Response;
}

/** The CORS middleware for one Worker, bound to its policy. */
export function cors(policy: CorsPolicy) {
  const methods = policy.methods.join(', ');
  return async <C extends CorsContext>(c: C, next: () => Promise<void>): Promise<Response | void> => {
    const origin = c.req.header('Origin') ?? '';
    // No Origin header ⇒ a non-browser caller (server-to-server, curl, the
    // Flutter desktop/mobile HTTP stack). CORS is a browser mechanism and there
    // is nothing to reflect, so this is unaffected — and was never protected by
    // CORS anyway.
    const allowed =
      origin === '' ? '*' : resolveOrigin(origin, allowlist(c.env.ALLOWED_ORIGINS), policy.scope) ?? '';

    if (allowed) {
      c.header('Access-Control-Allow-Origin', allowed);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Headers', ALLOW_HEADERS);
      c.header('Access-Control-Allow-Methods', methods);
    }
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
  };
}
