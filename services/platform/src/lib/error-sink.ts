// ─────────────────────────────────────────────────────────────────────────────
// error-sink.ts — [pipeline 11]E-8. A Worker's unhandled error reaches a sink,
// not just `console.error`.
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
  requestId: string | undefined;
  method: string;
  /** PATHNAME ONLY. Never the full URL — the query string is where the personal
   *  data hides. */
  path: string;
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
    transaction: `${ctx.method} ${ctx.path}`,
    tags: {
      service: ctx.service,
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
    await fetch(parsed.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        // NEVER a CF-Connecting-IP header: Cloudflare's edge rejects any client
        // request carrying one with error 1000, before the origin is reached.
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=nikatru-worker/1`,
      },
      body: buildEnvelope(err, ctx, env.GLITCHTIP_DSN as string, now),
    });
    return true;
  } catch {
    // Fail open. A sink that can break the request path is worse than no sink.
    return false;
  }
}
