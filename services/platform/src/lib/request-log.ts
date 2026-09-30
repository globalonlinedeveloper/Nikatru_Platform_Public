// ─────────────────────────────────────────────────────────────────────────────
// request-log.ts — ONE STRUCTURED LINE PER REQUEST, CARRYING THE ROUTE PATTERN.
//
// ⏱ 2026-09-30 · O-CALENDAR-TOKEN-SHIPPED-TO-ERROR-SINK, review of #1090 minor 2.
// wrangler.jsonc switches Workers Logs' INVOCATION logs off, because each one
// records the full request URL and two of this Worker's URLs are capabilities.
// That also removed the per-request rows that per-route timing was read from
// (the lead's obs.mjs measured `DELETE /v1/account` from them). This line puts
// the timing back without the URL: the ROUTE PATTERN (`/v1/calendar/:file`,
// never the path), the method, the status, the wall time in ms and the colo.
// Its `message` carries all of them, so a reader that matches on the message
// text (obs.mjs selects on `/v1/account`) reads it with no change.
//
// 🔴 NO LINE AT ALL ON A CAPABILITY ROUTE. Measured 2026-09-30 against this
// Worker's live Workers Logs: a `console` event carries its invocation's
// `$workers.event` metadata (a cron line carries `event.cron`), and every fetch
// invocation event carried `$workers.event.request.url`. So a console line
// written while serving `/v1/calendar/<token>.ics` or
// `/v1/reminders/unsubscribe?t=<token>` is presumed to carry the token in its
// metadata, whatever its message says — the safe reading until a post-deploy
// query shows otherwise. Those routes are named below, and writing nothing is
// the only line that cannot leak. onError's `[unhandled]` line honours the same
// set (index.ts); GlitchTip still gets its report, scrubbed.
// ─────────────────────────────────────────────────────────────────────────────
import type { Context, Next } from 'hono';
import { matchedRoutes } from 'hono/route';
import type { AppEnv } from '../types';
import { reportablePath } from './error-sink';

/**
 * The route patterns whose URL is a capability: the token IS the credential,
 * in the path (the calendar feed) or the query (the one-click unsubscribe).
 * test/request-log.test.ts holds each one to a route the app really mounts, so a
 * rename cannot silently unmark it.
 */
export const CAPABILITY_ROUTES: ReadonlySet<string> = new Set(['/v1/calendar/:file', '/v1/reminders/unsubscribe']);

/** The route pattern this request matched, or its scrubbed path when none did. */
export function routeOf(c: Context<AppEnv>): string {
  return reportablePath(new URL(c.req.url).pathname, matchedRoutes(c));
}

/** True when a console line written for this request must not be written. */
export function isCapabilityRequest(c: Context<AppEnv>): boolean {
  return CAPABILITY_ROUTES.has(routeOf(c));
}

export interface RequestLine {
  message: string;
  route: string;
  method: string;
  status: number;
  ms: number;
  colo: string | null;
}

/** The line itself, built from nothing but the pattern and the outcome. */
export function requestLine(route: string, method: string, status: number, ms: number, colo: string | null): RequestLine {
  return { message: `[req] ${method} ${route} ${status} ${ms}ms colo=${colo ?? '-'}`, route, method, status, ms, colo };
}

/** The middleware: time the request, then log one line unless it is a capability route. */
export async function requestLog(c: Context<AppEnv>, next: Next): Promise<void> {
  const start = Date.now();
  let threw = false;
  try {
    await next();
  } catch (err) {
    threw = true;
    throw err;
  } finally {
    const route = routeOf(c);
    if (!CAPABILITY_ROUTES.has(route)) {
      const colo = (c.req.raw as { cf?: { colo?: unknown } }).cf?.colo;
      console.log(
        requestLine(route, c.req.method, threw ? 500 : c.res.status, Date.now() - start, typeof colo === 'string' ? colo : null),
      );
    }
  }
}
