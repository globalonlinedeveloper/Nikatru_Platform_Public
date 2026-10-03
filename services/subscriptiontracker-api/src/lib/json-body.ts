// ─────────────────────────────────────────────────────────────────────────────
// json-body.ts — EVERY JSON BODY THIS WORKER READS IS READ BOUNDED, ONCE.
//
// ⏱ 2026-10-01 · lane fix-st-api-bounds (rv2-services-025). Every write route
// here began with `await c.req.json()`, which materialises the WHOLE body in the
// isolate before any check runs, so one signed-in caller could push the isolate
// past its memory limit with one request — a silent runtime kill that takes
// every other request on that isolate with it. The bound is the kit's
// `readBoundedBody` (services/_shared/src/body.ts: Content-Length as an early
// reject, the stream itself budgeted), and the caps are DERIVED from the
// MAX_* bounds of the route that owns the body, beside those bounds.
//
// 🔴 ONE READ, AHEAD OF THE IDEMPOTENCY CLAIM. `idempotentCreate` hashes the
// body before the handler runs, so the cap must be in front of it or the claim
// would read the body unbounded first. `boundedJson` reads and parses once and
// both read the parsed value through `jsonBody`.
//
// 🔴 `jsonBody` THROWS WHEN NO BOUNDED READ RAN. It used to be possible to read
// a body with `c.req.json()` anywhere; a route mounted without `boundedJson`
// now fails loudly (a 500 the error sink reports) instead of quietly reading an
// unbounded body.
//
// NOT named `body.ts`: that name is the kit's shared home, and a carrier of it
// must be exactly a re-export (services/platform/test/twinned-worker-modules
// .test.ts). This is a Hono middleware ON TOP of the kit's reader, so it imports
// `readBoundedBody` rather than restating it.
// ─────────────────────────────────────────────────────────────────────────────
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { readBoundedBody } from '../../../_shared/src/body';

export { readBoundedBody };

/** A body this wide in characters is at most 4 × as many UTF-8 bytes.
 *  @ceiling none — a property of UTF-8 (RFC 3629), not a platform resource. */
export const UTF8_MAX_BYTES_PER_CHAR = 4;

/** What `boundedJson` parsed, per request. */
const parsed = new WeakMap<Request, unknown>();

/**
 * Read the body bounded to [maxBytes] and parse it as JSON, or answer:
 *   · 413 `body_too_large` — over the cap, declared (Content-Length) or actual;
 *   · 400 `bad_content_length` / `bad_body` — a malformed header or a broken stream;
 *   · 400 `invalid_json` — the answer every route here gave a bad body before.
 * Nothing downstream runs on any of those, so no row is written.
 */
export function boundedJson(maxBytes: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const read = await readBoundedBody(c.req.raw, maxBytes);
    if (!read.ok) return c.json({ error: read.error, ...(read.status === 413 ? { max_bytes: maxBytes } : {}) }, read.status);
    let value: unknown;
    try {
      value = JSON.parse(read.text);
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    parsed.set(c.req.raw, value);
    await next();
  };
}

/** The body `boundedJson` parsed for this request. Throws if none ran (see the header). */
export function jsonBody(c: Context<AppEnv>): unknown {
  if (!parsed.has(c.req.raw)) {
    throw new Error('jsonBody: this route read a body without boundedJson in front of it');
  }
  return parsed.get(c.req.raw);
}
