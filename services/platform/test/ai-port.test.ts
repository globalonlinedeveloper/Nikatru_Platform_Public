// ai-port.test.ts — the composition root's AI tables (src/ports.ts) are the
// registry's (tooling/ports/ai.json `features` and the anthropic row's
// `cost.models`), and `aiFor` builds no provider the customer has not paid for:
// no model yet, no meter, or no key — each refused, with nothing sent.
import { describe, expect, it } from 'vitest';
import AI_RAW from '../../../tooling/ports/ai.json?raw';
import { AI_FEATURES, AI_MODEL_CANDIDATES, costUsd } from '../../_shared/src/ports/ai';
import { GRANT, conformanceRequest, CONFORMANCE_ROWS_TEXT } from '../../_shared/test/conformance/ai';
import { AI_COST_MODEL, AI_FEATURE_TABLE, aiFor } from '../src/ports';

const AI = JSON.parse(AI_RAW) as {
  adapters: Array<{ id: string; half?: string; cost: { models?: Record<string, Record<string, unknown>> } }>;
  features: Record<string, { adapter: string; model: string | null; effort: string | null; candidates: string[] }>;
};
const SENTINEL = 'sentinel-never-logged-sentinel-never-logged';

describe('src/ports.ts is tooling/ports/ai.json', () => {
  it('every feature, its adapter, its model and its effort — and nothing else', () => {
    const want = Object.fromEntries(Object.entries(AI.features).map(([f, ft]) => [f, { adapter: ft.adapter, model: ft.model, effort: ft.effort }]));
    expect(AI_FEATURE_TABLE).toEqual(want);
    expect([...AI_FEATURES].sort()).toEqual(Object.keys(AI.features).sort());
  });

  it("the candidate list is the registry's, for every feature", () => {
    for (const ft of Object.values(AI.features)) expect(ft.candidates).toEqual([...AI_MODEL_CANDIDATES]);
  });

  it("every model's price is the anthropic row's (asOf included); the verify command lives in the registry", () => {
    const models = AI.adapters.find((a) => a.id === 'anthropic')?.cost.models ?? {};
    expect(Object.keys(AI_COST_MODEL).sort()).toEqual(Object.keys(models).sort());
    for (const [id, p] of Object.entries(models)) {
      const { source: _s, verify: _v, ...prices } = p;
      const { verify: _mine, ...ours } = AI_COST_MODEL[id];
      expect(ours).toEqual(prices);
    }
  });

  it("costUsd prices a call from the table: Opus 5.5 at 3,000 in and 500 out is 0.022 USD", () => {
    expect(costUsd(AI_COST_MODEL, 'claude-opus-5-5', { inputTokens: 3000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(0.022, 12);
    expect(costUsd(AI_COST_MODEL, 'claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBeCloseTo(0.2, 12);
    expect(costUsd(AI_COST_MODEL, 'not-a-model', { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });
});

describe('aiFor — CUSTOMER-PAYS: no provider without a model, a meter and a key', () => {
  it('today every feature has no model yet, so nothing can call a model even with a meter and a key', () => {
    for (const f of AI_FEATURES) {
      const sel = aiFor(f, { NIKATRU_ANTHROPIC_API_KEY: SENTINEL }, { beforeCall: GRANT });
      expect(sel).toEqual({ ok: false, detail: `ai: feature ${f} has no model yet (tooling/ports/ai.json features.${f}.model)` });
    }
  });

  it('🔴 with a model set, no meter still means no provider — and with a meter, the provider calls through it', async () => {
    const row = AI_FEATURE_TABLE.import as { adapter: 'anthropic'; model: string | null; effort: string | null };
    const saved = row.model;
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: CONFORMANCE_ROWS_TEXT }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      row.model = 'claude-haiku-4-5';
      expect(aiFor('import', { NIKATRU_ANTHROPIC_API_KEY: SENTINEL }, { fetchImpl })).toEqual({ ok: false, detail: 'ai: no meter is wired (beforeCall), so no provider is built' });
      expect(aiFor('import', {}, { beforeCall: GRANT, fetchImpl })).toEqual({ ok: false, detail: 'ai: NIKATRU_ANTHROPIC_API_KEY is not set on this Worker' });
      const sel = aiFor('import', { NIKATRU_ANTHROPIC_API_KEY: SENTINEL }, { beforeCall: GRANT, fetchImpl });
      expect(sel.ok).toBe(true);
      if (!sel.ok) return;
      expect(sel.model).toBe('claude-haiku-4-5');
      const out = await sel.provider.complete({ ...conformanceRequest(sel.model) });
      expect(out.ok).toBe(true);
      expect(calls).toBe(1);
      // No selection ever carries the key.
      expect(JSON.stringify({ ...sel, provider: sel.provider.id }).includes(SENTINEL) ? 'match' : 'no match').toBe('no match');
    } finally {
      row.model = saved;
    }
  });
});
