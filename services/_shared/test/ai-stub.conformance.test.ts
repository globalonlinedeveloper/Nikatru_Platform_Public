// ai-stub.conformance.test.ts — the AI stub (src/ports/fakes/ai.ts) passes the
// same conformance suite as every real adapter, scripted to answer each scenario
// the way the provider would. Its `calls` counter is what T17's meter tests
// read: a refused reservation, or no meter at all, leaves it at zero.
import { describe, expect, it } from 'vitest';
import { createStubAi, type StubAiAnswer } from '../src/ports/fakes/ai';
import type { AiBeforeCall, AiUsage } from '../src/ports/ai';
import { CONFORMANCE_LIMITS, CONFORMANCE_ROWS_TEXT, CONFORMANCE_TRUNCATED_TEXT, FALLBACK_ATTEMPTS, GRANT, conformanceRequest, runAiConformance, type AiHarness } from './conformance/ai';

const SENTINEL = 'sentinel-never-logged-sentinel-never-logged';
const CACHED: AiUsage = { inputTokens: 42, outputTokens: 17, cacheReadTokens: 2048, cacheWriteTokens: 512 };

function harness(beforeCall: AiBeforeCall | undefined, answers: StubAiAnswer[] = [], expectedUsage?: AiUsage): AiHarness {
  const stub = createStubAi({ beforeCall, limits: CONFORMANCE_LIMITS, defaultText: CONFORMANCE_ROWS_TEXT });
  for (const a of answers) stub.answer(a);
  return {
    provider: stub,
    calls: () => stub.calls,
    models: () => stub.requests.map((r) => r.model),
    ...(expectedUsage ? { expectedUsage } : {}),
  };
}

runAiConformance({
  adapter: 'stub',
  secret: SENTINEL,
  fixtures: {
    'structured-rows': (b) => harness(b),
    refusal: (b) => harness(b, [{ kind: 'stop', stopReason: 'refusal', text: null }]),
    'max-tokens': (b) => harness(b, [{ kind: 'stop', stopReason: 'max_tokens', text: CONFORMANCE_TRUNCATED_TEXT }]),
    'usage-reported': (b) => harness(b, [{ kind: 'stop', stopReason: 'end_turn', text: CONFORMANCE_ROWS_TEXT, usage: CACHED }], CACHED),
    'reservation-refused': (b) => harness(b),
    'no-meter': (b) => harness(b),
    'key-not-logged': (b) => harness(b, [{ kind: 'stop', stopReason: 'end_turn', text: CONFORMANCE_ROWS_TEXT }, { kind: 'status', status: 429 }, { kind: 'status', status: 400 }, { kind: 'status', status: 503 }, { kind: 'hang' }]),
    'rate-limited': (b) => harness(b, [{ kind: 'status', status: 429 }]),
    'server-error': (b) => harness(b, [{ kind: 'status', status: 503 }]),
    'bad-request': (b) => harness(b, [{ kind: 'status', status: 400 }]),
    'model-from-config': (b) => harness(b),
    'unpriced-model': (b) => harness(b),
    'no-input-cap': (b) => harness(b),
    'input-over-cap': (b) => harness(b),
    'fallback-metered': (b) => harness(b, [{ kind: 'stop', stopReason: 'end_turn', text: CONFORMANCE_ROWS_TEXT, servedModel: 'claude-opus-4-8', usage: FALLBACK_ATTEMPTS[1].usage, attempts: FALLBACK_ATTEMPTS }]),
    'reservation-covers-charge': (b) => harness(b, [{ kind: 'stop', stopReason: 'end_turn', text: CONFORMANCE_ROWS_TEXT, usage: CACHED }]),
    'timeout-settles-at-reservation': (b) => harness(b, [{ kind: 'hang' }]),
  },
}, { describe, it });

describe('the AI stub counts, and answers what it was scripted', () => {
  it('records each request that reached its wire, in order, with the model asked for', async () => {
    const stub = createStubAi({ beforeCall: GRANT, limits: CONFORMANCE_LIMITS, defaultText: CONFORMANCE_ROWS_TEXT });
    await stub.complete(conformanceRequest('claude-sonnet-5-5'));
    await stub.complete(conformanceRequest('claude-haiku-4-5'));
    expect(stub.calls).toBe(2);
    expect(stub.requests.map((r) => r.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-4-5']);
  });

  it('a 401 is `unavailable` (the credential was refused), not retryable', async () => {
    const stub = createStubAi({ beforeCall: GRANT, limits: CONFORMANCE_LIMITS });
    stub.answer({ kind: 'status', status: 401 });
    const out = await stub.complete(conformanceRequest());
    expect(out).toMatchObject({ ok: false, kind: 'unavailable', retryable: false, status: 401 });
  });

  it('an ended answer that does not match the schema is `invalid`, and names a path, never a value', async () => {
    const stub = createStubAi({ beforeCall: GRANT, limits: CONFORMANCE_LIMITS });
    stub.answer({ kind: 'stop', stopReason: 'end_turn', text: JSON.stringify({ rows: [{ name: 'Private name', amount: 'nine' }] }) });
    const out = await stub.complete(conformanceRequest());
    expect(out).toMatchObject({ ok: false, kind: 'invalid' });
    expect(out.ok ? '' : out.detail).toContain('$.rows[0].amount');
    expect(out.ok ? '' : out.detail).not.toContain('Private name');
  });

  it('a reservation that THROWS is a refusal too: nothing reaches the wire', async () => {
    const stub = createStubAi({ beforeCall: async () => { throw new Error('meter down'); }, limits: CONFORMANCE_LIMITS });
    const out = await stub.complete(conformanceRequest());
    expect(out).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(stub.calls).toBe(0);
  });
});
