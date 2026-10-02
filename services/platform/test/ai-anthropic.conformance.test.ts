// ai-anthropic.conformance.test.ts — the Anthropic adapter (src/adapters/ai/
// anthropic.ts) passes the AI port's conformance suite over RECORDED bytes of
// the Messages API, through the official SDK, with no network.
//
// Each fixture is a carrier answering as the Claude API docs record, read
// 2026-10-02:
//   · https://platform.claude.com/docs/en/build-with-claude/structured-outputs —
//     the 200 body (`type: message`, a `text` block holding the JSON,
//     `stop_reason`, `usage`), and that a `refusal` and a `max_tokens` stop are
//     200s whose output "may not match your schema";
//   · https://platform.claude.com/docs/en/api/errors — the error shape
//     `{type: "error", error: {type, message}, request_id}` and the status per
//     type (400 invalid_request_error, 429 rate_limit_error, 500 api_error,
//     529 overloaded_error);
//   · https://platform.claude.com/docs/en/about-claude/pricing — the cache usage
//     fields (`cache_read_input_tokens`, `cache_creation_input_tokens`).
// The carrier reads the request the SDK wrote, so a dropped field, a wrong model
// or a leaked key fails here, never against the live API (this lane calls no
// live model: fixtures and the stub only).
//   · the claude-api skill, TypeScript README "Refusal Fallbacks" (cached
//     2026-09-25, read 2026-10-02): "The header must be exactly
//     `server-side-fallback-2026-06-01` for this array form; the newer
//     `fallbacks: "default"` scalar form uses `server-side-fallback-2026-07-01`
//     instead … pairing either header with the other form returns a 400." The
//     carrier answers that 400 too (FALLBACK_HEADER_FOR_FORM below).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CONFORMANCE_LIMITS,
  CONFORMANCE_PRICES,
  CONFORMANCE_ROWS_TEXT,
  CONFORMANCE_TRUNCATED_TEXT,
  FALLBACK_ATTEMPTS,
  FALLBACK_CHARGE_USD,
  GRANT,
  conformanceRequest,
  runAiConformance,
  type AiHarness,
} from '../../_shared/test/conformance/ai';
import { settle, type AiBeforeCall, type AiLimits, type AiUsage } from '../../_shared/src/ports/ai';
import { createAnthropicAi } from '../src/adapters/ai/anthropic';

/** The key every harness is built with: a sentinel, never a real key. */
const SENTINEL = 'sentinel-never-logged-sentinel-never-logged';
const MESSAGES_URL = /^https:\/\/api\.anthropic\.com\/v1\/messages(\?beta=true)?$/;

/** One `usage.iterations` entry, as the refusals-and-fallback page records it. */
interface Iteration {
  readonly type: 'message' | 'fallback_message';
  readonly model: string | null;
  readonly usage: AiUsage;
}

type Answer =
  | {
      readonly status: 200;
      readonly stop: 'end_turn' | 'max_tokens' | 'refusal';
      readonly text: string | null;
      readonly usage?: AiUsage;
      readonly servedModel?: string;
      readonly iterations?: readonly Iteration[];
    }
  | { readonly status: 400 | 429 | 500 | 529 }
  | 'unreachable'
  | 'hang';

/**
 * The reference's (form -> header) table, as LITERALS: never the adapter's
 * constant, so a swapped constant fails here (review of #1136, mutation R12).
 */
const FALLBACK_HEADER_FOR_FORM = { array: 'server-side-fallback-2026-06-01', default: 'server-side-fallback-2026-07-01' } as const;

/** The body's fallback form, or null when it sends none. */
function fallbackForm(body: Record<string, unknown>): keyof typeof FALLBACK_HEADER_FOR_FORM | null {
  if (Array.isArray(body.fallbacks)) return 'array';
  if (body.fallbacks === 'default') return 'default';
  return null;
}

/** The server-side-fallback beta the request carries, or null. */
function fallbackHeader(headers: Headers): string | null {
  return (headers.get('anthropic-beta') ?? '').split(',').map((b) => b.trim()).find((b) => b.startsWith('server-side-fallback-')) ?? null;
}

const ERROR_TYPE: Record<number, string> = { 400: 'invalid_request_error', 429: 'rate_limit_error', 500: 'api_error', 529: 'overloaded_error' };

const wireUsage = (u: AiUsage) => ({
  input_tokens: u.inputTokens,
  output_tokens: u.outputTokens,
  cache_read_input_tokens: u.cacheReadTokens,
  cache_creation_input_tokens: u.cacheWriteTokens,
});

/** The recorded 200 body for one stop. */
function messageBody(model: string, a: Extract<Answer, { status: 200 }>): unknown {
  const u = a.usage ?? { inputTokens: 123, outputTokens: 45, cacheReadTokens: 0, cacheWriteTokens: 0 };
  return {
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    model: a.servedModel ?? model,
    content: [
      // Opus 5.5 always thinks: the display default is "omitted", an empty thinking block first.
      { type: 'thinking', thinking: '', signature: 'fixture-signature' },
      ...(a.iterations ? [{ type: 'fallback', from: { model }, to: { model: a.servedModel ?? model } }] : []),
      ...(a.text === null ? [] : [{ type: 'text', text: a.text }]),
    ],
    stop_reason: a.stop,
    stop_sequence: null,
    ...(a.stop === 'refusal' ? { stop_details: { type: 'refusal', category: null, explanation: null } } : {}),
    usage: {
      ...wireUsage(u),
      ...(a.iterations ? { iterations: a.iterations.map((it) => ({ type: it.type, model: it.model, ...wireUsage(it.usage) })) } : {}),
    },
  };
}

interface Seen {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

/** A Messages API carrier answering each request with the next of `answers` (the last repeats). */
function carrier(answers: Answer[]) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (!MESSAGES_URL.test(req.url)) throw new Error(`unexpected URL ${req.url}`);
    const body = JSON.parse(await req.text()) as Record<string, unknown>;
    seen.push({ url: req.url, headers: req.headers, body });
    const json = (o: unknown, status: number) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_fixture' } });
    // The API pairs the beta header with the body form: either one alone, or the other form's header, is a 400.
    const form = fallbackForm(body);
    const header = fallbackHeader(req.headers);
    if ((form === null) !== (header === null) || (form !== null && header !== FALLBACK_HEADER_FOR_FORM[form])) {
      return json({ type: 'error', error: { type: 'invalid_request_error', message: 'fixture: fallback header and form disagree' }, request_id: 'req_fixture' }, 400);
    }
    const a = answers[Math.min(seen.length - 1, answers.length - 1)];
    if (a === 'unreachable') throw new TypeError('fetch failed');
    if (a === 'hang') {
      return new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    if (a.status !== 200) return json({ type: 'error', error: { type: ERROR_TYPE[a.status], message: 'fixture' }, request_id: 'req_fixture' }, a.status);
    return json(messageBody(String(body.model), a), 200);
  }) as typeof fetch;
  return { fetchImpl, seen };
}

// The meter is an explicit argument with NO default: a default would turn a deliberate `undefined` (no meter) into a grant.
const build = (fetchImpl: typeof fetch, beforeCall: AiBeforeCall | undefined, limits: AiLimits = CONFORMANCE_LIMITS, timeoutMs = 2_000) =>
  createAnthropicAi({ apiKey: SENTINEL, beforeCall, limits, fetchImpl, timeoutMs });

function harness(beforeCall: AiBeforeCall | undefined, answers: Answer[], expectedUsage?: AiUsage, timeoutMs = 2_000): AiHarness {
  const { fetchImpl, seen } = carrier(answers);
  return {
    provider: build(fetchImpl, beforeCall, CONFORMANCE_LIMITS, timeoutMs),
    calls: () => seen.length,
    models: () => seen.map((s) => String(s.body.model)),
    ...(expectedUsage ? { expectedUsage } : {}),
  };
}

const ROWS: Answer = { status: 200, stop: 'end_turn', text: CONFORMANCE_ROWS_TEXT };
const CACHED: AiUsage = { inputTokens: 42, outputTokens: 17, cacheReadTokens: 2048, cacheWriteTokens: 512 };

/** Opus 5.5 declined mid-output, Opus 4.8 answered: the recorded body of the refusals-and-fallback page's example. */
const FALLBACK: Answer = {
  status: 200,
  stop: 'end_turn',
  text: CONFORMANCE_ROWS_TEXT,
  servedModel: 'claude-opus-4-8',
  usage: FALLBACK_ATTEMPTS[1].usage,
  iterations: [
    { type: 'message', model: 'claude-opus-5-5', usage: FALLBACK_ATTEMPTS[0].usage },
    { type: 'fallback_message', model: 'claude-opus-4-8', usage: FALLBACK_ATTEMPTS[1].usage },
  ],
};

// The first case pays the SDK's first, lazy load: warmed here, with its own bound,
// so no conformance case races vitest's 5 s default (review 1 of #1136, nit 8).
beforeAll(async () => {
  await import('@anthropic-ai/sdk');
}, 30_000);

runAiConformance({
  adapter: 'anthropic',
  secret: SENTINEL,
  fixtures: {
    'structured-rows': (b) => harness(b, [ROWS]),
    refusal: (b) => harness(b, [{ status: 200, stop: 'refusal', text: 'I can not help with that.' }]),
    'max-tokens': (b) => harness(b, [{ status: 200, stop: 'max_tokens', text: CONFORMANCE_TRUNCATED_TEXT }]),
    'usage-reported': (b) => harness(b, [{ status: 200, stop: 'end_turn', text: CONFORMANCE_ROWS_TEXT, usage: CACHED }], CACHED),
    'reservation-refused': (b) => harness(b, [ROWS]),
    'no-meter': (b) => harness(b, [ROWS]),
    'key-not-logged': (b) => harness(b, [ROWS, { status: 429 }, { status: 400 }, { status: 500 }, 'unreachable']),
    'rate-limited': (b) => harness(b, [{ status: 429 }]),
    'server-error': (b) => harness(b, [{ status: 529 }]),
    'bad-request': (b) => harness(b, [{ status: 400 }]),
    'model-from-config': (b) => harness(b, [ROWS]),
    'unpriced-model': (b) => harness(b, [ROWS]),
    'no-input-cap': (b) => harness(b, [ROWS]),
    'input-over-cap': (b) => harness(b, [ROWS]),
    'fallback-metered': (b) => harness(b, [FALLBACK]),
    'reservation-covers-charge': (b) => harness(b, [{ status: 200, stop: 'end_turn', text: CONFORMANCE_ROWS_TEXT, usage: CACHED }]),
    'timeout-settles-at-reservation': (b) => harness(b, ['hang'], undefined, 300),
  },
}, { describe, it: (name, body) => it(name, body, 20_000) });

describe("the Anthropic adapter's wire, as the SDK writes it", () => {
  it('structured output, the cached system prefix and the key header — and no thinking field, no prefill', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    await build(fetchImpl, GRANT).complete(conformanceRequest('claude-haiku-4-5'));
    const { body, headers } = seen[0];
    expect(body.output_config).toMatchObject({ format: { type: 'json_schema' } });
    expect(body).not.toHaveProperty('output_format');
    expect(body.system).toEqual([{ type: 'text', text: conformanceRequest().system, cache_control: { type: 'ephemeral' } }]);
    expect(body).not.toHaveProperty('thinking');
    const messages = body.messages as Array<{ role: string }>;
    expect(messages.map((m) => m.role)).toEqual(['user']);
    // "match" / "no match" only: the key is never printed, even by a test.
    expect(headers.get('x-api-key') === SENTINEL ? 'match' : 'no match').toBe('match');
  });

  it('Haiku 4.5 gets no effort field and no fallback (it refuses the first, and its chain is empty)', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    await build(fetchImpl, GRANT).complete(conformanceRequest('claude-haiku-4-5'));
    expect((seen[0].body.output_config as Record<string, unknown>).effort).toBeUndefined();
    expect(seen[0].body).not.toHaveProperty('fallbacks');
    expect(seen[0].headers.get('anthropic-beta')).toBeNull();
  });

  it('Opus 5.5 sends its EXPLICIT, priced fallback chain from config — never "default" — and an explicit effort', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    await build(fetchImpl, GRANT).complete(conformanceRequest('claude-opus-5-5'));
    expect(seen[0].body.fallbacks).toEqual([{ model: 'claude-opus-4-8' }, { model: 'claude-opus-5' }]);
    // The array form's header, from the reference's table — a literal, never the adapter's constant.
    expect(fallbackForm(seen[0].body)).toBe('array');
    expect(fallbackHeader(seen[0].headers)).toBe('server-side-fallback-2026-06-01');
    expect((seen[0].body.output_config as Record<string, unknown>).effort).toBe('medium');
    const low = carrier([ROWS]);
    await build(low.fetchImpl, GRANT).complete({ ...conformanceRequest('claude-opus-5-5'), effort: 'low' });
    expect((low.seen[0].body.output_config as Record<string, unknown>).effort).toBe('low');
  });

  it('Sonnet 5.5 sends NO fallback (its default routing is unpublished, so it cannot be priced), and an explicit effort', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    await build(fetchImpl, GRANT).complete(conformanceRequest('claude-sonnet-5-5'));
    expect(seen[0].body).not.toHaveProperty('fallbacks');
    expect(seen[0].headers.get('anthropic-beta')).toBeNull();
    expect((seen[0].body.output_config as Record<string, unknown>).effort).toBe('medium');
  });

  it('🔴 a fallback chain is billed attempt by attempt, each at its own price: the hand computation, never the served attempt alone', async () => {
    const { fetchImpl } = carrier([FALLBACK]);
    const out = await build(fetchImpl, GRANT).complete(conformanceRequest('claude-opus-5-5'));
    expect(out).toMatchObject({ ok: true, servedModel: 'claude-opus-4-8' });
    expect(out.billing).toEqual({ known: true, attempts: FALLBACK_ATTEMPTS });
    const st = settle(CONFORMANCE_PRICES, out.reservedUsd ?? 0, out);
    expect(st.chargeUsd).toBeCloseTo(FALLBACK_CHARGE_USD, 12);
    expect(st.chargeUsd).toBeLessThanOrEqual(out.reservedUsd ?? 0);
  });

  it('an iteration that names no model is the requested model', async () => {
    const { fetchImpl } = carrier([{ ...(FALLBACK as Extract<Answer, { status: 200 }>), iterations: [{ type: 'message', model: null, usage: FALLBACK_ATTEMPTS[0].usage }, { type: 'fallback_message', model: 'claude-opus-4-8', usage: FALLBACK_ATTEMPTS[1].usage }] }]);
    const out = await build(fetchImpl, GRANT).complete(conformanceRequest('claude-opus-5-5'));
    expect(out.billing).toEqual({ known: true, attempts: FALLBACK_ATTEMPTS });
  });

  it('🔴 a fallback chain that reaches an UNPRICED model is refused before the meter and the wire', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    let asked = 0;
    const meter: AiBeforeCall = async () => {
      asked++;
      return { ok: true, id: 'r' };
    };
    const out = await build(fetchImpl, meter, { ...CONFORMANCE_LIMITS, fallbacks: { 'claude-opus-5-5': ['claude-opus-unpriced'] } }).complete(conformanceRequest('claude-opus-5-5'));
    expect(out).toMatchObject({ ok: false, kind: 'invalid' });
    expect(asked).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('images ride before the text, as base64 blocks, and each one is bounded in the reservation', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    await build(fetchImpl, GRANT).complete({ ...conformanceRequest(), images: [{ mediaType: 'image/png', base64: 'iVBORw0KGgo=' }] });
    const content = (seen[0].body.messages as Array<{ content: Array<{ type: string }> }>)[0].content;
    expect(content.map((c) => c.type)).toEqual(['image', 'text']);
  });

  it('🔴 CUSTOMER-PAYS: with no beforeCall wired the adapter refuses, and the SDK never reaches the carrier', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    const out = await build(fetchImpl, undefined).complete(conformanceRequest('claude-opus-5-5'));
    expect(out).toMatchObject({ ok: false, kind: 'unavailable', retryable: false });
    expect(seen).toHaveLength(0);
  });

  it('a 401 is `unavailable` and not billed; an aborted call is `timeout` with usage UNKNOWN', async () => {
    const unauthorized = (async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'fixture' } }), { status: 401 })) as typeof fetch;
    expect(await build(unauthorized, GRANT).complete(conformanceRequest())).toMatchObject({ ok: false, kind: 'unavailable', status: 401, billing: { known: true, attempts: [] } });
    const { fetchImpl } = carrier(['hang']);
    const ctl = new AbortController();
    const pending = build(fetchImpl, GRANT).complete(conformanceRequest(), { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 20);
    expect(await pending).toMatchObject({ ok: false, kind: 'timeout', retryable: false, billing: { known: false } });
  });

  it('🔴 the Opus 5.5 call with its fallback chain is ANSWERED by a carrier that refuses a mismatched header and form', async () => {
    const { fetchImpl } = carrier([FALLBACK]);
    expect(await build(fetchImpl, GRANT).complete(conformanceRequest('claude-opus-5-5'))).toMatchObject({ ok: true, servedModel: 'claude-opus-4-8' });
  });

  it("the carrier's table is the reference's: each header with the other form, or alone, is a 400", async () => {
    const { fetchImpl } = carrier([ROWS]);
    const post = (beta: string | null, fallbacks: unknown) =>
      fetchImpl('https://api.anthropic.com/v1/messages?beta=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(beta ? { 'anthropic-beta': beta } : {}) },
        body: JSON.stringify({ model: 'claude-opus-5-5', ...(fallbacks === undefined ? {} : { fallbacks }) }),
      });
    expect((await post('server-side-fallback-2026-06-01', [{ model: 'claude-opus-4-8' }])).status).toBe(200);
    expect((await post('server-side-fallback-2026-07-01', 'default')).status).toBe(200);
    expect((await post('server-side-fallback-2026-07-01', [{ model: 'claude-opus-4-8' }])).status).toBe(400);
    expect((await post('server-side-fallback-2026-06-01', 'default')).status).toBe(400);
    expect((await post(null, [{ model: 'claude-opus-4-8' }])).status).toBe(400);
    expect((await post('server-side-fallback-2026-06-01', undefined)).status).toBe(400);
  });

  it('🔴 an error AFTER the request was handed to the SDK (an unparseable 200) is billing-unknown and settles at the reservation', async () => {
    const garbled = (async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const out = await build(garbled, GRANT).complete(conformanceRequest());
    expect(out).toMatchObject({ ok: false, kind: 'invalid', billing: { known: false } });
    expect(settle(CONFORMANCE_PRICES, out.reservedUsd ?? 0, out).chargeUsd).toBe(out.reservedUsd);
    expect(out.reservedUsd ?? 0).toBeGreaterThan(0);
  });
});
