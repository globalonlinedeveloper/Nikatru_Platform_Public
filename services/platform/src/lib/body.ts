// ─────────────────────────────────────────────────────────────────────────────
// BOUND THE BODY **BEFORE** PARSING IT.
//
// 🔴 THE DEFECT THIS EXISTS FOR. `c.req.json()` was the first statement of the
// /v1/events handler. Both protections that look like they bound the request —
// the 413 on `events.length > 100` and the cost circuit breaker — evaluated
// AFTER that line, so they graded a value that only existed because the isolate
// had already materialised the whole body. One unauthenticated multi-MB POST
// therefore allocated multi-MB in the isolate that also serves GET /config/:app,
// and the 429 it eventually received was proof the parse had already happened.
// Reproduced at HEAD: an 8 MB body returned 429 — after being fully parsed.
//
// ⚠️ CONTENT-LENGTH IS A HINT, NOT A BOUND. It is caller-supplied: it can be
// absent (chunked transfer-encoding), or it can lie. So it is used only as a
// cheap early reject, and the read itself is independently budgeted — the
// stream is cancelled the moment the accumulated byte count exceeds the cap, so
// the peak allocation is the cap plus one chunk regardless of what the header
// claimed or how many bytes the caller intended to send.
//
// Bytes, not characters: the cap must bound memory, and one JSON character can
// be four UTF-8 bytes.
// ─────────────────────────────────────────────────────────────────────────────

/** Either the fully-read body text, or the status/error the route must return. */
export type BoundedBody =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Read at most `maxBytes` of `req`'s body, refusing anything larger.
 *
 * Returns `{ ok: false, status: 413 }` for an over-cap body (declared OR
 * actual) and `{ ok: false, status: 400 }` for a Content-Length that is not a
 * non-negative integer, or a body that fails mid-stream. An absent body reads
 * as the empty string, which the caller's `JSON.parse` rejects as it would any
 * other malformed body.
 */
export async function readBoundedBody(req: Request, maxBytes: number): Promise<BoundedBody> {
  const declared = req.headers.get('content-length');
  if (declared !== null && declared !== '') {
    // `Number('')` is 0 and `Number('12abc')` is NaN — a header that is present
    // but not a count is malformed, and treating it as "no header" would be a
    // free way to skip this limb.
    const n = Number(declared);
    if (!Number.isInteger(n) || n < 0) return { ok: false, status: 400, error: 'bad_content_length' };
    if (n > maxBytes) return { ok: false, status: 413, error: 'body_too_large' };
  }

  const body = req.body;
  if (!body) return { ok: true, text: '' };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      // Checked BEFORE the chunk is retained: the cap bounds what is kept.
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: 'body_too_large' };
      }
      chunks.push(value);
    }
  } catch {
    // A truncated or aborted upload. The client's own request never completed,
    // so this is a 400, not a 503 the client would retry against.
    return { ok: false, status: 400, error: 'bad_body' };
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf) };
}
