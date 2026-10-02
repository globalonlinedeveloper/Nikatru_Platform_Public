import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildEnvelope, parseDsn, reportWorkerError } from '../src/error-sink';

// ─────────────────────────────────────────────────────────────────────────────
// error-sink.test.ts — THE SINK MODULE'S OWN CASES, beside the one home.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-033).
// These lived twice, in services/platform/test/error-sink.test.ts and
// services/subscriptiontracker-api/test/error-sink.test.ts, over one module
// (src/error-sink.ts) — and the brick's stamped Worker had neither, so a stamped
// app ran the sink untested. They moved here, where every Worker's vitest runs
// them (`../_shared/test/**` is in each `include`). What stays in each carrier
// is its WIRING: its real `onError` reaching this sink and naming that Worker.
//
// [pipeline 11]E-8. Two assertions here failed on the tree they were written
// against by construction: the envelope names the WORKER it came from, and its
// release is NOT the literal "v1" (`API_VERSION`, which would group every error
// into one bucket named after a URL prefix). The PRIVACY assertions are why this
// ships to the same GlitchTip instance as the app's crashes at all: the query
// string, the body and the headers must never appear in the payload.
// ─────────────────────────────────────────────────────────────────────────────

const DSN = 'https://abc123@glitchtip.example.test/7';
const NOW = new Date('2026-08-02T10:00:00.000Z');

const CTX = {
  service: 'subscriptiontracker-api',
  release: 'deadbeefcafe',
  requestId: 'rid-1',
  method: 'POST',
  path: '/v1/events',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the DSN is parsed, never spliced', () => {
  it('derives the envelope endpoint and the public key', () => {
    expect(parseDsn(DSN)).toEqual({
      endpoint: 'https://glitchtip.example.test/api/7/envelope/',
      publicKey: 'abc123',
    });
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not a URL', 'nonsense'],
    ['no public key', 'https://glitchtip.example.test/7'],
    ['no project id', 'https://abc123@glitchtip.example.test'],
  ])('returns null for a %s DSN rather than POSTing somewhere unintended', (_label, dsn) => {
    expect(parseDsn(dsn as string | undefined)).toBeNull();
  });
});

describe('the envelope', () => {
  const parse = () => {
    const [header, itemHeader, item] = buildEnvelope(new TypeError('boom'), CTX, DSN, NOW).split('\n');
    return { header: JSON.parse(header), itemHeader: JSON.parse(itemHeader), event: JSON.parse(item) };
  };

  it('is three newline-delimited JSON objects, the Sentry envelope shape', () => {
    const { header, itemHeader, event } = parse();
    expect(header.dsn).toBe(DSN);
    expect(header.sent_at).toBe(NOW.toISOString());
    expect(itemHeader).toEqual({ type: 'event' });
    // The envelope header's id and the event's id must be the same event.
    expect(event.event_id).toBe(header.event_id);
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('NAMES THE WORKER it came from — in server_name and in the tags', () => {
    const { event } = parse();
    expect(event.server_name).toBe('subscriptiontracker-api');
    expect(event.tags.service).toBe('subscriptiontracker-api');
  });

  it('carries a release that is NOT the literal "v1"', () => {
    // The assertion that could not have passed on the tree this replaced, and
    // the one that stops `API_VERSION` being reached for as a release id.
    const { event } = parse();
    expect(event.release).toBe('deadbeefcafe');
    expect(event.release).not.toBe('v1');
  });

  it('carries the error type and message, and the correlation id', () => {
    const { event } = parse();
    expect(event.level).toBe('error');
    expect(event.exception.values[0].type).toBe('TypeError');
    expect(event.exception.values[0].value).toBe('boom');
    expect(event.tags.request_id).toBe('rid-1');
    expect(event.transaction).toBe('POST /v1/events');
  });

  it('turns a non-Error throw into a reportable exception', () => {
    const [, , item] = buildEnvelope('a bare string', CTX, DSN, NOW).split('\n');
    const event = JSON.parse(item);
    expect(event.exception.values[0].value).toBe('a bare string');
  });

  it('omits the request_id tag rather than inventing one', () => {
    const [, , item] = buildEnvelope(new Error('x'), { ...CTX, requestId: undefined }, DSN, NOW).split('\n');
    expect(JSON.parse(item).tags).not.toHaveProperty('request_id');
  });

  it('tags the report with the APP when the request named one', () => {
    const [, , item] = buildEnvelope(new Error('x'), { ...CTX, appId: 'subscriptiontracker' }, DSN, NOW).split('\n');
    expect(JSON.parse(item).tags.app_id).toBe('subscriptiontracker');
  });

  it('OMITS the app_id tag when the request failed before naming an app', () => {
    const [, , item] = buildEnvelope(new Error('x'), CTX, DSN, NOW).split('\n');
    expect(JSON.parse(item).tags).not.toHaveProperty('app_id');
  });
});

describe('the privacy invariants of the payload', () => {
  it('carries NO query string, NO body, NO headers and NO address', () => {
    // Fed a context whose path is a pathname, which is the only thing onError
    // hands it. The assertion is over the SERIALISED envelope, so a field added
    // anywhere in the payload has to pass it.
    const envelope = buildEnvelope(new Error('boom'), CTX, DSN, NOW);
    for (const forbidden of ['email=', 'token=', 'cf-connecting-ip', 'authorization', 'cookie']) {
      expect(envelope.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('the sink fails open', () => {
  it('sends nothing and reports false when no DSN is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await reportWorkerError(new Error('x'), CTX, {}, NOW)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never rejects when GlitchTip is unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    // A sink that can break the request path is worse than no sink.
    await expect(reportWorkerError(new Error('x'), CTX, { GLITCHTIP_DSN: DSN }, NOW)).resolves.toBe(false);
  });

  // 🔴 REGRESSION TEST.
  // `reportWorkerError` returned `true` for any non-throwing response, so a
  // sink rejecting every report looked exactly like one delivering them. The
  // envelope is hand-rolled and every test here mocks `fetch`, so the format
  // went unvalidated against the live server until 2026-08-04.
  it('🔴 reports FALSE when the sink REJECTS the envelope', async () => {
    for (const status of [400, 403, 413, 429, 500]) {
      vi.stubGlobal('fetch', async () => new Response('', { status }));
      expect(
        await reportWorkerError(new Error('x'), CTX, { GLITCHTIP_DSN: DSN }, NOW),
        `HTTP ${status} from the sink must not read as a delivered report`,
      ).toBe(false);
    }
  });

  it('POSTs to the envelope endpoint with the Sentry auth header', async () => {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response('', { status: 200 });
    });
    expect(await reportWorkerError(new Error('x'), CTX, { GLITCHTIP_DSN: DSN }, NOW)).toBe(true);
    const [url, init] = calls[0];
    expect(url).toBe('https://glitchtip.example.test/api/7/envelope/');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-sentry-auth']).toContain('sentry_key=abc123');
    expect(headers['content-type']).toBe('application/x-sentry-envelope');
    // Cloudflare's edge rejects any client request carrying this header with
    // error 1000, before the origin is reached.
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('cf-connecting-ip');
  });
});
