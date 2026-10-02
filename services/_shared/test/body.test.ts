import { describe, it, expect } from 'vitest';
import { readBoundedBody } from '../src/body';

// ─────────────────────────────────────────────────────────────────────────────
// body.test.ts — the body is bounded BEFORE it is parsed, by bytes, whatever
// Content-Length claims. ⏱ 2026-10-01 · services-009: src/body.ts is the one home
// every Worker (and every stamped one) carries; these cases run in each of them.
// ─────────────────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

/** A request whose body arrives as `chunks`, with no Content-Length — the chunked
 *  shape a caller uses to skip the header limb. */
function streamed(chunks: string[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Request('https://x.test/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
}

describe('readBoundedBody', () => {
  it('reads a body inside the cap, text and exact bytes', async () => {
    const res = await readBoundedBody(new Request('https://x.test/', { method: 'POST', body: '{"a":1}' }), 64);
    expect(res).toEqual({ ok: true, text: '{"a":1}', bytes: enc.encode('{"a":1}') });
  });

  it('an absent body reads as the empty string', async () => {
    await expect(readBoundedBody(new Request('https://x.test/', { method: 'POST' }), 8)).resolves.toMatchObject({ ok: true, text: '' });
  });

  it('🔴 a declared Content-Length over the cap is 413 before a byte is read', async () => {
    const req = new Request('https://x.test/', { method: 'POST', body: 'x', headers: { 'content-length': '9999' } });
    await expect(readBoundedBody(req, 10)).resolves.toEqual({ ok: false, status: 413, error: 'body_too_large' });
  });

  it('a Content-Length that is not a count is 400, not "no header"', async () => {
    for (const bad of ['12abc', '-1', '1.5']) {
      const req = new Request('https://x.test/', { method: 'POST', body: 'x', headers: { 'content-length': bad } });
      await expect(readBoundedBody(req, 10)).resolves.toEqual({ ok: false, status: 400, error: 'bad_content_length' });
    }
  });

  it('🔴 a streamed body with NO Content-Length is still cut off at the cap', async () => {
    await expect(readBoundedBody(streamed(['12345', '67890', 'X']), 10)).resolves.toEqual({
      ok: false,
      status: 413,
      error: 'body_too_large',
    });
  });

  it('the cap is BYTES, not characters: four 4-byte characters do not fit in 15', async () => {
    const req = streamed(['😀😀😀😀']);
    await expect(readBoundedBody(req, 15)).resolves.toMatchObject({ ok: false, status: 413 });
  });
});
