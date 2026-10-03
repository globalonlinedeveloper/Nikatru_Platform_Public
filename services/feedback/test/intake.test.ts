import { describe, it, expect, vi, afterEach } from 'vitest';
import { app } from '../src/index';
import { ANON_PER_HOUR, MAX_IMAGE_BYTES, MAX_TEXT_CHARS } from '../src/lib/limits';
import { CTX, harness, multipart, pngWithMetadata, validReport, type Harness } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// intake.test.ts — POST /v1/feedback through the REAL app, over the shipped
// schema (lane feedback-intake). Each 🔴 case is one of the brief's red controls:
// delete the check it names in src/ and the case fails.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function post(h: Harness, body: Record<string, unknown> | FormData, headers: Record<string, string> = {}) {
  const isForm = body instanceof FormData;
  const init: RequestInit = {
    method: 'POST',
    headers: isForm ? headers : { 'content-type': 'application/json', ...headers },
    body: isForm ? body : JSON.stringify(body),
  };
  return app.fetch(new Request('https://feedback.example.test/v1/feedback', init), h.env as never, CTX as never);
}

const rows = (h: Harness) => h.db.rows('SELECT * FROM feedback_reports');

describe('a report is stored, privacy-safe', () => {
  it('stores one row and answers 201 with its id', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await post(h, validReport());
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(/^FB-[0-9A-Z]{10}$/);
    expect(rows(h)).toHaveLength(1);
    expect(rows(h)[0]).toMatchObject({ id, user_id: null, app_id: 'subscriptiontracker', category: 'bug', status: 'new', app_version: '1.4.0' });
  });

  it('🔴 [Do 2] `a@b.com 4111 1111 1111 1111` is stored masked, and so are a phone number and a UPI id', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await post(h, validReport({ description: 'charged twice, mail a@b.com 4111 1111 1111 1111', steps: 'call +91 98765 43210 or pay asha@okhdfc' }));
    const [row] = rows(h);
    expect(row.description).toBe('charged twice, mail [email] [card]');
    expect(row.steps).toBe('call [phone] or pay [upi]');
    expect(JSON.stringify(row)).not.toContain('4111');
    expect(JSON.stringify(row)).not.toContain('a@b.com');
  });

  it('🔴 [Do 1, server half] a report without a description is refused and writes nothing', async () => {
    const h = harness();
    for (const description of ['', '   ', undefined]) {
      const res = await post(h, validReport({ description }));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: 'required', field: 'description' });
    }
    expect(rows(h)).toHaveLength(0);
  });

  it('🔴 [Do 3] with the logs opt-in off the stored diagnostics have no `logs` key; with it on, each line is masked again', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await post(h, validReport());
    expect(Object.keys(JSON.parse(String(rows(h)[0].diagnostics)))).not.toContain('logs');
    const on = validReport();
    (on.diagnostics as Record<string, unknown>).logs = ['sync failed for a@b.com'];
    await post(h, on);
    expect(JSON.parse(String(rows(h)[1].diagnostics)).logs).toEqual(['sync failed for [email]']);
  });

  it('🔴 [Do 3] a device model or identifier has nowhere to go: an unknown diagnostics key is refused', async () => {
    const h = harness();
    const r = validReport();
    (r.diagnostics as Record<string, unknown>).deviceModel = 'Pixel 9 Pro';
    const res = await post(h, r);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unknown_key', field: 'diagnostics.deviceModel' });
    expect(rows(h)).toHaveLength(0);
  });

  it('🔴 [Do 9] a payload carrying a `url`, at any depth, is refused', async () => {
    const h = harness();
    for (const extra of [{ url: 'https://example.com/private' }, { diagnostics: { appVersion: '1', URL: 'x' } }]) {
      const res = await post(h, validReport(extra));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'url_refused' });
    }
    expect(rows(h)).toHaveLength(0);
  });
});

describe('🔴 [Do 10] consent to be contacted', () => {
  it('with both boxes unticked the stored row has no contact, even when an address was typed', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await post(h, validReport({ contactEmail: 'asha@example.com' }));
    expect(rows(h)[0]).toMatchObject({ contact_email: null, reply_ok: 0, notify_fixed: 0 });
  });

  it('"you may reply to me" while signed out keeps the typed address; "tell me when fixed" is its own flag', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await post(h, validReport({ contactEmail: 'Asha@Example.com', consent: { reply: true, notifyFixed: true } }));
    expect(rows(h)[0]).toMatchObject({ contact_email: 'asha@example.com', reply_ok: 1, notify_fixed: 1 });
  });
});

describe('🔴 [Do 6] rate limits and spam control, without storing an address', () => {
  it('the 4th anonymous report in an hour from one address is refused with 429; another address is not', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const from = (ip: string) => ({ 'CF-Connecting-IP': ip });
    for (let i = 0; i < ANON_PER_HOUR; i++) expect((await post(h, validReport(), from('203.0.113.7'))).status).toBe(201);
    const fourth = await post(h, validReport(), from('203.0.113.7'));
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get('Retry-After')).toBe('3600');
    expect((await post(h, validReport(), from('198.51.100.9'))).status).toBe(201);
    expect(rows(h)).toHaveLength(ANON_PER_HOUR + 1);
  });

  it('no column anywhere holds the address — only a 16-hex hash under a per-window salt', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await post(h, validReport(), { 'CF-Connecting-IP': '203.0.113.7' });
    const everything = JSON.stringify([
      h.db.rows('SELECT * FROM feedback_reports'),
      h.db.rows('SELECT * FROM feedback_rate_windows'),
      h.db.rows('SELECT * FROM feedback_rate_salts'),
    ]);
    expect(everything).not.toContain('203.0.113.7');
    for (const w of h.db.rows('SELECT key_hash FROM feedback_rate_windows')) expect(String(w.key_hash)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('a payload over the caps is refused with 413: a 4,001-character description, a 2 MB+ image, a body past the cap', async () => {
    const h = harness();
    expect((await post(h, validReport({ description: 'x'.repeat(MAX_TEXT_CHARS + 1) }))).status).toBe(413);
    expect((await post(h, validReport({ steps: 'x'.repeat(MAX_TEXT_CHARS + 1) }))).status).toBe(413);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(pngWithMetadata());
    expect((await post(h, multipart(validReport(), big))).status).toBe(413);
    expect(rows(h)).toHaveLength(0);
  });

  it('a filled honeypot is accepted-and-dropped: 202, an id, no row and no object', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await post(h, multipart(validReport({ website: 'http://spam.example' }), pngWithMetadata()));
    expect(res.status).toBe(202);
    expect(((await res.json()) as { id: string }).id).toMatch(/^FB-/);
    expect(rows(h)).toHaveLength(0);
    expect(h.bucket.keys()).toEqual([]);
  });

  it('a submit faster than a person types, and more than three links, are refused', async () => {
    const h = harness();
    expect((await post(h, validReport({ elapsedMs: 200 }))).status).toBe(422);
    const links = 'see https://a.test https://b.test https://c.test https://d.test';
    expect((await post(h, validReport({ description: links }))).status).toBe(422);
    expect(rows(h)).toHaveLength(0);
  });

  it('a token that is present and does not verify is a 401, never a silent downgrade to anonymous', async () => {
    const h = harness();
    vi.stubGlobal('fetch', async () => Response.json({ keys: [] }));
    const res = await post(h, validReport(), { Authorization: 'Bearer not.a.jwt' });
    expect(res.status).toBe(401);
    expect(rows(h)).toHaveLength(0);
  });
});

describe('🔴 [Do 4] offline-safe: a replayed report is stored once', () => {
  it('the same idempotency key twice is one row, and the second answer names the first id', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = validReport();
    const first = (await (await post(h, r)).json()) as { id: string };
    const again = await post(h, r);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id: first.id, status: 'duplicate' });
    expect(rows(h)).toHaveLength(1);
  });
});

describe('🔴 [Do 5] the screenshot: stripped, private, never served by a route', () => {
  it('PNG text and EXIF chunks are stripped before the object is stored', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await post(h, multipart(validReport(), pngWithMetadata()));
    expect(res.status).toBe(201);
    const [key] = h.bucket.keys();
    expect(key).toMatch(/^shots\/FB-[0-9A-Z]{10}\.png$/);
    const stored = new TextDecoder('latin1').decode(new Uint8Array(await (await h.bucket.get(key))!.arrayBuffer()));
    expect(stored).not.toContain('tEXt');
    expect(stored).not.toContain('Pixel 9 Pro');
    expect(stored).not.toContain('eXIf');
    expect(stored).not.toContain('device-serial');
    expect(stored).toContain('IDAT');
    expect(rows(h)[0].screenshot_key).toBe(key);
  });

  it('a file that is not a PNG or WebP is refused and nothing is stored', async () => {
    const h = harness();
    const res = await post(h, multipart(validReport(), new TextEncoder().encode('GIF89a not allowed'), 'image/gif'));
    expect(res.status).toBe(400);
    expect(h.bucket.keys()).toEqual([]);
    expect(rows(h)).toHaveLength(0);
  });

  it('no route answers a GET under /v1/feedback, and no method reaches a stored screenshot', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { id } = (await (await post(h, multipart(validReport(), pngWithMetadata()))).json()) as { id: string };
    const [key] = h.bucket.keys();
    for (const path of [`/v1/feedback/${id}`, `/v1/feedback/${id}/screenshot`, `/${key}`, `/v1/${key}`, `/v1/screenshots/${id}`]) {
      const res = await app.fetch(new Request(`https://feedback.example.test${path}`), h.env as never, CTX as never);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-type') ?? '').not.toMatch(/^image\//);
    }
    const reads = app.routes.filter((r) => r.method === 'GET' || r.method === 'ALL').map((r) => r.path);
    // The one GET under /v1/feedback is the unsubscribe page (lane feedback-triage),
    // which reads a token's address and serves a button, never an object.
    expect(reads.filter((p) => p !== '/*' && p !== '*')).toEqual(['/v1/health', '/v1/feedback/unsubscribe']);
  });
});

describe('the go-live flag', () => {
  it('anything but INTAKE_OPEN="true" answers 503 intake_closed and writes nothing', async () => {
    for (const flag of [undefined, 'false', 'TRUE']) {
      const h = harness({ INTAKE_OPEN: flag });
      const res = await post(h, validReport());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'intake_closed' });
      expect(rows(h)).toHaveLength(0);
    }
  });
});
