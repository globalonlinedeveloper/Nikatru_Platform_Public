// ─────────────────────────────────────────────────────────────────────────────
// error-sink.ts — [pipeline 11]E-8. A Worker's unhandled error reaches a sink,
// not just `console.error`. THE ONE HOME.
//
// ── ⚠️ THIS FILE USED TO BE TWO FILES ────────────────────────────────────────
// Until [ADR 067] `services/platform/src/lib/error-sink.ts` (200 lines,
// 6d905986ab73) and `services/subscriptiontracker-api/src/lib/error-sink.ts` (196 lines,
// bc2a03e2a6f3) were separate copies, held equal declaration-by-declaration by
// `services/platform/test/twinned-worker-modules.test.ts` and by nothing else.
// Both carriers now RE-EXPORT this file, and that test asserts that they do.
//
// 🔴 THE TWO DECLARED DIVERGENCES ARE NOW ONE OPTIONAL FIELD, AND THE
// BEHAVIOUR IS UNCHANGED. The divergence was `SinkContext.appId` and the
// `...(ctx.appId ? { app_id: ctx.appId } : {})` tag it feeds — [pipeline B-16],
// present in the platform copy and absent from subscriptiontracker-api's. Both lines are
// here, and the field is OPTIONAL: platform passes `c.get('appId')` and gets
// the tag; subscriptiontracker-api passes nothing, `ctx.appId` is `undefined`, and the spread
// contributes nothing — byte for byte the envelope subscriptiontracker-api built before. The
// asymmetry that justified the exemption is still real and still stated:
// platform is the ONE Worker every stamped app posts to, so a report there has
// to say WHOSE app broke; subscriptiontracker-api serves exactly one app, so
// `service: "subscriptiontracker-api"` already answers that question.
//
// ⚠️ AN ABSENT TAG IS HONEST; A PLACEHOLDER TAG IS A SECOND APP CALLED
// "unknown" WITH ITS OWN ERROR TREND. That is why the spread is conditional
// rather than `app_id: ctx.appId ?? 'unknown'`, and it is why making the field
// optional is not the same as giving it a default.
//
// ⚠️ NOTHING IN `services/_shared/src/` MAY CARRY A BARE IMPORT — see the
// measured refusal in `services/_shared/src/health.ts`'s header (tsc and
// esbuild both fail; wrangler's suggested `alias` is refused because it
// bypasses a package's `exports` conditions). This module needs nothing:
// `fetch` and `crypto.randomUUID` are runtime globals, and `env` arrives as the
// structural `{ GLITCHTIP_DSN?: string }` the caller already had to satisfy.
//
// 🔴 THE DEFECT THIS CLOSES. `app.onError` logged and returned 500. A `wrangler
// tail` is a live stream nobody is watching at 3am and Cloudflare's Free plan
// keeps no searchable log history, so an unhandled error on the SHARED Worker —
// the one every stamped app posts its analytics, consent, entitlement and
// merchant-of-record traffic to — produced exactly one artefact: a 500 the
// client saw. `grep -rn "sentry\|glitchtip" services/` returned zero hits while
// the Flutter app's crashes had been reaching GlitchTip since July.
//
// ⚠️ HAND-ROLLED ENVELOPE, NO SDK, AND THAT IS THE POINT. `@sentry/cloudflare`
// is tens of kilobytes of the 1 MB (compressed) Worker script budget and pulls
// its own instrumentation into a request path that answers config lookups on
// every app launch. The Sentry envelope is three newline-delimited JSON objects
// over one POST; GlitchTip speaks it. Thirty lines beats a dependency here.
//
// PRIVACY — this ships to the SAME instance as the app's crashes, so the same
// rules apply and they are enforced by construction rather than by a scrubber:
//   • NO request body, NO headers, NO cookies, NO query string. The query
//     string is the one that looks harmless and is not: `?email=` is a URL.
//   • NO client IP. `CF-Connecting-IP` is never read here or anywhere in this
//     Worker, which is the whole posture of [ADR 011] / [ADR 020].
//   • The pathname only, plus the correlation id already in the response
//     header, so a report can be tied to a log line without tying it to a user.
//   • And not even the pathname's VALUES: a capability can be a path segment
//     (the calendar feed's token), so the route PATTERN is reported and any
//     capability-shaped segment is scrubbed — `reportablePath` below.
//
// FAIL-OPEN, ALWAYS. Every failure mode — no DSN, an unparseable DSN, GlitchTip
// down, a network error — resolves to "no report". Reporting an error must
// never be able to turn a 500 into a hang.
// ─────────────────────────────────────────────────────────────────────────────

/** A DSN is `https://<publicKey>@<host>/<projectId>`. */
interface ParsedDsn {
  endpoint: string;
  publicKey: string;
}

/** Parsed rather than string-spliced: a malformed DSN must produce "no report",
 *  never a POST to somewhere unintended. */
export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!u.username || !projectId) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      publicKey: u.username,
    };
  } catch {
    return null;
  }
}

/** 32 lowercase hex characters — the id shape Sentry's ingest requires. */
const eventId = (): string => crypto.randomUUID().replaceAll('-', '');

export interface SinkContext {
  /** The Worker this error came from. A COMPILE-TIME constant supplied by the
   *  caller, never `env.APP_ID`: a report that cannot say which Worker produced
   *  it is a report nobody can act on, and an env var can be blanked by a
   *  deploy. */
  service: string;
  /** The commit this Worker was deployed from. Supplied by the deploy as
   *  `--var RELEASE:<sha>`.
   *
   *  🔴 DELIBERATELY NOT `API_VERSION`. That var is the literal string "v1" in
   *  both Workers and has never changed, so using it as the release would put
   *  every error this factory ever reports into one bucket named after a URL
   *  prefix — a release identity that cannot distinguish today's deploy from
   *  the one that introduced the bug. When [9]R-2 gives every lane a real
   *  release id this reads that instead; until then it is the deployed SHA,
   *  which is at least monotonic and at least resolvable to a diff. */
  release: string | undefined;
  /** [pipeline B-16] The app this request was for, when the route got far
   *  enough to resolve and validate one. `undefined` on the paths that failed
   *  before any app was named — see `Variables.appId` for why that is not
   *  filled in with a placeholder. */
  appId?: string;
  requestId: string | undefined;
  method: string;
  /** PATHNAME ONLY. Never the full URL — the query string is where the personal
   *  data hides. Pass it through `reportablePath`, which replaces every path
   *  PARAMETER with its route pattern name; `buildEnvelope` scrubs
   *  capability-shaped segments again whatever the caller passed. */
  path: string;
}

/** One route the router matched: what hono's `matchedRoutes(c)` returns, typed
 *  structurally because this home may carry no bare import. */
export interface MatchedRoute {
  method: string;
  path: string;
}

/**
 * A path segment shaped like a CAPABILITY: 32 or more base64url/hex characters,
 * optionally with a file extension. The calendar feed's 256-bit token is 43 of
 * them (`/v1/calendar/<token>.ics`); a UUID (36, hyphenated) matches too, which
 * costs nothing — an id in a report groups worse, never better.
 */
const SECRET_SEGMENT = /^[A-Za-z0-9_-]{32,}(\.[A-Za-z0-9]+)?$/;

/** Every capability-shaped segment of `path`, replaced by `:redacted`. */
export function scrubPath(path: string): string {
  return path
    .split('/')
    .map((seg) => (SECRET_SEGMENT.test(seg) ? ':redacted' : seg))
    .join('/');
}

/**
 * ⏱ 2026-09-30 · O-CALENDAR-TOKEN-SHIPPED-TO-ERROR-SINK (rv2-services-002).
 * THE PATH A REPORT MAY CARRY: the ROUTE PATTERN the request matched
 * (`/v1/calendar/:file`), not the concrete pathname.
 *
 * 🔴 THE DEFECT. The privacy rule above assumed a secret could only live in the
 * query string, but the calendar feed's capability token is a PATH segment: an
 * unhandled error on `GET /v1/calendar/<token>.ics` sent the live token to
 * GlitchTip as the event's transaction, and anyone who could read GlitchTip could
 * then read that person's subscriptions until the feed was rotated. It also split
 * every token into its own error group.
 *
 * A path parameter is how the router marks a segment as a VALUE rather than a
 * name, so no parameter value is reported at all — the pattern names each one
 * instead. The handler route is the last matched route with a concrete method
 * (`app.use` middleware is `ALL`). When the router matched no handler, the
 * concrete path is reported with every capability-shaped segment scrubbed.
 */
export function reportablePath(pathname: string, matched: readonly MatchedRoute[] = []): string {
  const handler = [...matched].reverse().find((r) => r.method !== 'ALL' && r.path && !r.path.includes('*'));
  return scrubPath(handler ? handler.path : pathname);
}

/** What `requestSinkContext` reads from a request: Hono's `Context`, described
 *  structurally because nothing here may carry a bare import (see the header). */
export interface SinkRequest {
  req: { method: string; url: string };
  env: { RELEASE?: string };
  get(key: 'requestId'): string | undefined;
}

/**
 * The context of one request's report, built ONCE. `app.onError` sends it, and
 * so does a route that answers around a failure (so onError never sees it) but
 * still owes a report — a purge that failed under a list that loaded. Two copies
 * of this block drift, and the pathname-only line is the one that must not. The
 * `reportWorkerError(` call itself stays inline in `app.onError`, where
 * assert-worker-error-sink limb 2 reads it.
 */
export function requestSinkContext(service: string, c: SinkRequest): SinkContext {
  return {
    service,
    release: c.env.RELEASE,
    requestId: c.get('requestId'),
    method: c.req.method,
    path: new URL(c.req.url).pathname, // pathname only — never the query string
  };
}

/** The Sentry envelope for one unhandled error: headers, item header, item. */
export function buildEnvelope(err: unknown, ctx: SinkContext, dsn: string, now: Date): string {
  const id = eventId();
  const error = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: id,
    timestamp: now.getTime() / 1000,
    platform: 'javascript',
    level: 'error',
    logger: 'worker',
    server_name: ctx.service,
    release: ctx.release,
    // Scrubbed here as well as by `reportablePath`: a Worker whose onError still
    // passes the concrete pathname cannot ship a path-segment token either.
    transaction: `${ctx.method} ${scrubPath(ctx.path)}`,
    tags: {
      service: ctx.service,
      // [pipeline B-16] WHOSE app broke, not merely which Worker. A TAG rather
      // than a body field because tags are what the sink can group and filter
      // by, and "show me every error for app X" is the question this exists to
      // make answerable across a 50-app portfolio on one shared host.
      // Omitted entirely when the request failed before naming an app — an
      // absent tag is honest, a placeholder tag is a second app called
      // "unknown" with its own error trend.
      ...(ctx.appId ? { app_id: ctx.appId } : {}),
      ...(ctx.requestId ? { request_id: ctx.requestId } : {}),
    },
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          // The stack is OUR code's, not the user's data. Kept: without it an
          // "internal_error" report says only that one happened.
          stacktrace: error.stack ? { frames: [{ function: error.stack.split('\n')[1]?.trim() }] } : undefined,
        },
      ],
    },
  };
  return [
    JSON.stringify({ event_id: id, sent_at: now.toISOString(), dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
}

/**
 * POST the envelope. Returns a promise the caller hands to `waitUntil`, so the
 * response is not held open waiting for GlitchTip — the client gets its 500
 * immediately and the report is delivered on the Worker's own time.
 *
 * Resolves to `false` when nothing was sent, and NEVER rejects.
 */
export async function reportWorkerError(
  err: unknown,
  ctx: SinkContext,
  env: { GLITCHTIP_DSN?: string },
  now: Date = new Date(),
): Promise<boolean> {
  const parsed = parseDsn(env.GLITCHTIP_DSN);
  if (!parsed) return false;
  try {
    const res = await fetch(parsed.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        // NEVER a CF-Connecting-IP header: Cloudflare's edge rejects any client
        // request carrying one with error 1000, before the origin is reached.
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=nikatru-worker/1`,
      },
      body: buildEnvelope(err, ctx, env.GLITCHTIP_DSN as string, now),
    });
    // ── 🔴 `res.ok`, NOT `true` — CORRECTED 2026-08-04 ────────────────────────
    // This returned `true` for ANY response the fetch did not throw on, so a
    // 400 or 403 from the sink was indistinguishable from a delivered report.
    // That mattered more than it looks: this envelope is HAND-ROLLED (no SDK),
    // every test mocks `fetch`, and so NOTHING had ever asked the live server
    // what it made of the format. The sink could have been rejecting every
    // report this factory ever sent and the only visible symptom would have
    // been an error tracker that looked reassuringly quiet.
    //
    // Validated live 2026-08-04 against glitchtip.nikatru.com by POSTing an
    // envelope built by THIS function: HTTP 200, event id
    // 65ee34800b324b9787b81bfbf9b2860f, landed as issue SUBLY-5. The format is
    // good — but "we checked once by hand" is not a property, and returning the
    // real verdict is what makes a future rejection observable at all.
    //
    // ⚠️ STILL FAILS OPEN. The caller hands this to `waitUntil` and ignores it;
    // a false return never touches the request path. It is a REPORT of what
    // happened, not a decision about it.
    return res.ok;
  } catch {
    // Fail open. A sink that can break the request path is worse than no sink.
    return false;
  }
}
