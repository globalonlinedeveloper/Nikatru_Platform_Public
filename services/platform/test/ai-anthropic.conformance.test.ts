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
import { describe, expect, it } from 'vitest';
import { conformanceRequest, CONFORMANCE_ROWS_TEXT, CONFORMANCE_TRUNCATED_TEXT, GRANT, runAiConformance, type AiHarness } from '../../_shared/test/conformance/ai';
import type { AiBeforeCall, AiUsage } from '../../_shared/src/ports/ai';
import { ANTHROPIC_FALLBACK_BETA, createAnthropicAi } from '../src/adapters/ai/anthropic';

/** The key every harness is built with: a sentinel, never a real key. */
const SENTINEL = 'sentinel-never-logged-sentinel-never-logged';
const MESSAGES_URL = /^https:\/\/api\.anthropic\.com\/v1\/messages(\?beta=true)?$/;

type Answer =
  | { readonly status: 200; readonly stop: 'end_turn' | 'max_tokens' | 'refusal'; readonly text: string | null; readonly usage?: AiUsage }
  | { readonly status: 400 | 429 | 500 | 529 }
  | 'unreachable';

const ERROR_TYPE: Record<number, string> = { 400: 'invalid_request_error', 429: 'rate_limit_error', 500: 'api_error', 529: 'overloaded_error' };

/** The recorded 200 body for one stop. */
function messageBody(model: string, a: Extract<Answer, { status: 200 }>): unknown {
  const u = a.usage ?? { inputTokens: 123, outputTokens: 45, cacheReadTokens: 0, cacheWriteTokens: 0 };
  return {
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    model,
    content: [
      // Opus 5.5 always thinks: the display default is "omitted", an empty thinking block first.
      { type: 'thinking', thinking: '', signature: 'fixture-signature' },
      ...(a.text === null ? [] : [{ type: 'text', text: a.text }]),
    ],
    stop_reason: a.stop,
    stop_sequence: null,
    ...(a.stop === 'refusal' ? { stop_details: { type: 'refusal', category: null, explanation: null } } : {}),
    usage: {
      input_tokens: u.inputTokens,
      output_tokens: u.outputTokens,
      cache_read_input_tokens: u.cacheReadTokens,
      cache_creation_input_tokens: u.cacheWriteTokens,
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
    const a = answers[Math.min(seen.length - 1, answers.length - 1)];
    if (a === 'unreachable') throw new TypeError('fetch failed');
    const json = (o: unknown, status: number) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_fixture' } });
    if (a.status !== 200) return json({ type: 'error', error: { type: ERROR_TYPE[a.status], message: 'fixture' }, request_id: 'req_fixture' }, a.status);
    return json(messageBody(String(body.model), a), 200);
  }) as typeof fetch;
  return { fetchImpl, seen };
}

function harness(beforeCall: AiBeforeCall | undefined, answers: Answer[], expectedUsage?: AiUsage): AiHarness {
  const { fetchImpl, seen } = carrier(answers);
  return {
    provider: createAnthropicAi({ apiKey: SENTINEL, beforeCall, fetchImpl, timeoutMs: 2_000 }),
    calls: () => seen.length,
    models: () => seen.map((s) => String(s.body.model)),
    ...(expectedUsage ? { expectedUsage } : {}),
  };
}

const ROWS: Answer = { status: 200, stop: 'end_turn', text: CONFORMANCE_ROWS_TEXT };
const CACHED: AiUsage = { inputTokens: 42, outputTokens: 17, cacheReadTokens: 2048, cacheWriteTokens: 512 };

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
  },
}, { describe, it });

describe("the Anthropic adapter's wire, as the SDK writes it", () => {
  it('structured output, the cached system prefix and the key header — and no thinking field, no prefill', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    const ai = createAnthropicAi({ apiKey: SENTINEL, beforeCall: GRANT, fetchImpl });
    await ai.complete(conformanceRequest('claude-haiku-4-5'));
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

  it('Haiku 4.5 gets no effort field and no fallback (it refuses the first; the second is for Opus and Sonnet)', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    await createAnthropicAi({ apiKey: SENTINEL, beforeCall: GRANT, fetchImpl }).complete(conformanceRequest('claude-haiku-4-5'));
    expect((seen[0].body.output_config as Record<string, unknown>).effort).toBeUndefined();
    expect(seen[0].body).not.toHaveProperty('fallbacks');
    expect(seen[0].headers.get('anthropic-beta')).toBeNull();
  });

  it('Opus 5.5 and Sonnet 5.5 get an EXPLICIT effort and the server-side refusal fallback, "default" form', async () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5'] as const) {
      const { fetchImpl, seen } = carrier([ROWS]);
      await createAnthropicAi({ apiKey: SENTINEL, beforeCall: GRANT, fetchImpl }).complete(conformanceRequest(model));
      expect((seen[0].body.output_config as Record<string, unknown>).effort).toBe('medium');
      expect(seen[0].body.fallbacks).toBe('default');
      expect(seen[0].headers.get('anthropic-beta')).toBe(ANTHROPIC_FALLBACK_BETA);
    }
    const { fetchImpl, seen } = carrier([ROWS]);
    await createAnthropicAi({ apiKey: SENTINEL, beforeCall: GRANT, fetchImpl }).complete({ ...conformanceRequest('claude-opus-5-5'), effort: 'low' });
    expect((seen[0].body.output_config as Record<string, unknown>).effort).toBe('low');
  });

  it('a rescued call names the model that served it, so the meter prices the right one', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ...(messageBody('claude-opus-5', { status: 200, stop: 'end_turn', text: CONFORMANCE_ROWS_TEXT }) as object) }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const out = await createAnthropicAi({ apiKey: SENTINEL, beforeCall: GRANT, fetchImpl }).complete(conformanceRequest('claude-opus-5-5'));
    expect(out).toMatchObject({ ok: true, servedModel: 'claude-opus-5' });
  });

  it('images ride before the text, as base64 blocks', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    await createAnthropicAi({ apiKey: SENTINEL, beforeCall: GRANT, fetchImpl }).complete({ ...conformanceRequest(), images: [{ mediaType: 'image/png', base64: 'iVBORw0KGgo=' }] });
    const content = (seen[0].body.messages as Array<{ content: Array<{ type: string }> }>)[0].content;
    expect(content.map((c) => c.type)).toEqual(['image', 'text']);
  });

  it('🔴 CUSTOMER-PAYS: with no beforeCall wired the adapter refuses, and the SDK never reaches the carrier', async () => {
    const { fetchImpl, seen } = carrier([ROWS]);
    const ai = createAnthropicAi({ apiKey: SENTINEL, fetchImpl });
    const out = await ai.complete(conformanceRequest('claude-opus-5-5'));
    expect(out).toMatchObject({ ok: false, kind: 'unavailable', retryable: false });
    expect(seen).toHaveLength(0);
  });

  it('a 401 is `unavailable` (the credential was refused) and an aborted call is `timeout`', async () => {
    const unauthorized = (async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'fixture' } }), { status: 401 })) as typeof fetch;
    expect(await createAnthropicAi({ apiKey: SENTINEL, beforeCall: GRANT, fetchImpl: unauthorized }).complete(conformanceRequest())).toMatchObject({ ok: false, kind: 'unavailable', status: 401 });
    const hanging = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as typeof fetch;
    const ctl = new AbortController();
    const pending = createAnthropicAi({ apiKey: SENTINEL, beforeCall: GRANT, fetchImpl: hanging }).complete(conformanceRequest(), { signal: ctl.signal });
    ctl.abort();
    expect(await pending).toMatchObject({ ok: false, kind: 'timeout', retryable: false });
  });
});
