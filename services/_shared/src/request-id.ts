// ─────────────────────────────────────────────────────────────────────────────
// request-id.ts — THE CORRELATION ID EVERY WORKER STAMPS, ECHOES AND LOGS. THE
// ONE HOME.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-018).
// Each Worker carried the same four lines — take `x-request-id` from the
// caller, else mint a uuid; set it on the context; echo it — and all three took
// the caller's value WHOLE. That value is then echoed in the response, written
// into every `[auth] rid=…` and `[unhandled] rid=…` log line, and sent to
// GlitchTip as the `request_id` tag (error-sink.ts). So any caller could put
// any bytes, of any length, into all three: a 500-character id is a 500-character
// tag on every error the request raises, and an id that carries an email address
// is personal data in a log line nobody meant to hold one.
//
// THE RULE. The caller's id is KEPT only when it is a plain token — letters,
// digits and `. _ : -`, one to 64 characters, which every id format in use
// (a uuid, a W3C trace id, a Cloudflare ray id) fits. Anything else is REPLACED
// by a fresh uuid, never truncated or cleaned: a mangled id would correlate with
// nothing, and a fresh one at least correlates this request's own lines.
//
// ⚠️ NO BARE IMPORT (services/_shared/test/shared-home.test.ts), so no `hono`
// type: the middleware is typed by the three members of the context it touches,
// which Hono's `Context` satisfies — the shape cors.ts uses.
// ─────────────────────────────────────────────────────────────────────────────

/** The header the id travels in, both directions. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** A caller-supplied id this Worker will carry: a plain token of 1–64 characters. */
export const REQUEST_ID_SHAPE = /^[A-Za-z0-9._:-]{1,64}$/;

/** The caller's id when it has the shape, else a fresh uuid. */
export function acceptRequestId(supplied: string | undefined): string {
  return supplied !== undefined && REQUEST_ID_SHAPE.test(supplied) ? supplied : crypto.randomUUID();
}

/** The members of Hono's request context this middleware uses, and no more. */
export interface RequestIdContext {
  readonly req: { header(name: string): string | undefined };
  set(key: 'requestId', value: string): void;
  header(name: string, value: string): void;
}

/** The middleware every Worker mounts first: stamp or propagate the id, echo it. */
export async function requestId<C extends RequestIdContext>(c: C, next: () => Promise<void>): Promise<void> {
  const rid = acceptRequestId(c.req.header(REQUEST_ID_HEADER));
  c.set('requestId', rid);
  c.header(REQUEST_ID_HEADER, rid);
  await next();
}
