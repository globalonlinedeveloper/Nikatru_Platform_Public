// ai-conformance.test.ts — the AI conformance suite must be able to FAIL.
//
// Each case runs one scenario of conformance/ai.ts against a MUTATED stub and
// expects the scenario to throw (vacuous-03: an assertion that cannot fail is
// worse than none). The green control is the unmutated stub, which passes every
// scenario in ai-stub.conformance.test.ts.
import { describe, expect, it } from 'vitest';
import { createStubAi, type StubAiProvider } from '../src/ports/fakes/ai';
import type { AiBeforeCall, AiProvider } from '../src/ports/ai';
import { CONFORMANCE_ROWS_TEXT, CONFORMANCE_TRUNCATED_TEXT, GRANT, REFUSE, checkAiScenario, runAiConformance, type AiHarness } from './conformance/ai';

const SENTINEL = 'sentinel-never-logged-sentinel-never-logged';

/** A harness over `provider`, counted by the stub underneath it. */
function over(provider: AiProvider, stub: StubAiProvider): AiHarness {
  return { provider, calls: () => stub.calls, models: () => stub.requests.map((r) => r.model) };
}

const truncatedStub = (b: AiBeforeCall | undefined = GRANT) => {
  const stub = createStubAi({ beforeCall: b });
  stub.answer({ kind: 'stop', stopReason: 'max_tokens', text: CONFORMANCE_TRUNCATED_TEXT });
  return stub;
};

describe('the ai conformance suite reddens', () => {
  it('green control: the unmutated stub passes `max-tokens`', async () => {
    const stub = truncatedStub();
    await expect(checkAiScenario('max-tokens', over(stub, stub), SENTINEL)).resolves.toBeUndefined();
  });

  it('🔴 a stub that returns ROWS on a max_tokens stop fails `max-tokens`', async () => {
    const stub = truncatedStub();
    const rowsAnyway: AiProvider = {
      id: 'stub',
      capabilities: stub.capabilities,
      async complete(req, o) {
        const out = await stub.complete(req, o);
        // The mutation: read the content before the stop reason, and keep what parses.
        if (!out.ok && out.stopReason === 'max_tokens') {
          return { ok: true, output: { rows: [] }, stopReason: 'end_turn', usage: out.usage!, servedModel: req.model, reservationId: out.reservationId! };
        }
        return out;
      },
    };
    await expect(checkAiScenario('max-tokens', over(rowsAnyway, stub), SENTINEL)).rejects.toThrow(/expected incomplete, got ok/);
  });

  it('🔴 a stub that calls a refusal "incomplete" fails `refusal`', async () => {
    const stub = createStubAi({ beforeCall: GRANT });
    stub.answer({ kind: 'stop', stopReason: 'refusal', text: null });
    const misread: AiProvider = {
      id: 'stub',
      capabilities: stub.capabilities,
      async complete(req, o) {
        const out = await stub.complete(req, o);
        return out.ok ? out : { ...out, kind: 'incomplete' };
      },
    };
    await expect(checkAiScenario('refusal', over(misread, stub), SENTINEL)).rejects.toThrow(/expected kind refused, got incomplete/);
  });

  it('🔴 an adapter that calls ANYWAY when the reservation is refused fails `reservation-refused`', async () => {
    const meterless = createStubAi({ beforeCall: GRANT, defaultText: CONFORMANCE_ROWS_TEXT });
    const ignoresMeter: AiProvider = {
      id: 'stub',
      capabilities: meterless.capabilities,
      async complete(req, o) {
        await meterless.complete(req, o); // the paid call happens…
        return { ok: false, kind: 'unavailable', retryable: false, detail: 'refused' }; // …and is reported as refused
      },
    };
    await expect(checkAiScenario('reservation-refused', over(ignoresMeter, meterless), SENTINEL)).rejects.toThrow(/2 call\(s\) reached the carrier without a reservation/);
  });

  it('🔴 an adapter that puts its key in a detail fails `key-not-logged`', async () => {
    const stub = createStubAi({ beforeCall: GRANT, defaultText: CONFORMANCE_ROWS_TEXT });
    for (const status of [429, 400, 503, 500]) stub.answer({ kind: 'status', status });
    const leaky: AiProvider = {
      id: 'stub',
      capabilities: stub.capabilities,
      async complete(req, o) {
        const out = await stub.complete(req, o);
        return out.ok ? out : { ...out, detail: `${out.detail} with key ${SENTINEL}` };
      },
    };
    await expect(checkAiScenario('key-not-logged', over(leaky, stub), SENTINEL)).rejects.toThrow(/the key appears in a log line, an outcome or an error-sink envelope: match/);
  });

  it('🔴 an adapter that LOGS its key fails `key-not-logged`, even when every detail is clean', async () => {
    const stub = createStubAi({ beforeCall: GRANT, defaultText: CONFORMANCE_ROWS_TEXT });
    for (const status of [429, 400, 503, 500]) stub.answer({ kind: 'status', status });
    const chatty: AiProvider = {
      id: 'stub',
      capabilities: stub.capabilities,
      async complete(req, o) {
        console.debug('calling with', { headers: { 'x-api-key': SENTINEL } });
        return stub.complete(req, o);
      },
    };
    await expect(checkAiScenario('key-not-logged', over(chatty, stub), SENTINEL)).rejects.toThrow(/: match/);
  });

  it('🔴 an adapter that pins its own model fails `model-from-config`', async () => {
    const stub = createStubAi({ beforeCall: GRANT, defaultText: CONFORMANCE_ROWS_TEXT });
    const pinned: AiProvider = { id: 'stub', capabilities: stub.capabilities, complete: (req, o) => stub.complete({ ...req, model: 'claude-opus-5-5' }, o) };
    await expect(checkAiScenario('model-from-config', over(pinned, stub), SENTINEL)).rejects.toThrow(/the two configured models were not sent as asked/);
  });

  it('green control: a refused meter is honoured by the unmutated stub (the counter the meter tests read stays 0)', async () => {
    const stub = truncatedStub(REFUSE);
    await expect(checkAiScenario('reservation-refused', over(stub, stub), SENTINEL)).resolves.toBeUndefined();
    expect(stub.calls).toBe(0);
  });

  it('a missing fixture throws at registration — never a skip', () => {
    expect(() => runAiConformance({ adapter: 'x', secret: SENTINEL, fixtures: {} }, { describe: () => undefined, it: () => undefined })).toThrow(/no fixture for structured-rows/);
  });
});
