// ai-port.test.ts — the composition root's AI tables (src/ports.ts) are the
// registry's (tooling/ports/ai.json `features`, and the anthropic row's
// `cost.models` and their `fallbacks`), the server adapters declare the
// capabilities the registry lists, and `aiFor` builds no provider the customer
// has not paid for: no model yet, no input cap, no meter, or no key — each
// refused, with nothing sent.
import { describe, expect, it } from 'vitest';
import AI_RAW from '../../../tooling/ports/ai.json?raw';
import { AI_FEATURES, AI_MODEL_CANDIDATES, costUsd, estimateInputTokens, reserveOrRefuse, type AiRequest } from '../../_shared/src/ports/ai';
import { createStubAi } from '../../_shared/src/ports/fakes/ai';
import { GRANT, conformanceRequest, CONFORMANCE_ROWS_TEXT } from '../../_shared/test/conformance/ai';
import { createAnthropicAi } from '../src/adapters/ai/anthropic';
import { AI_COST_MODEL, AI_FALLBACKS, AI_FEATURE_TABLE, aiFor, aiLimits } from '../src/ports';

const AI = JSON.parse(AI_RAW) as {
  adapters: Array<{ id: string; half?: string; capabilities: string[]; cost: { models?: Record<string, Record<string, unknown> & { fallbacks?: string[] }> } }>;
  features: Record<string, { adapter: string; model: string | null; effort: string | null; maxInputTokens: number | null; candidates: string[] }>;
};
const SENTINEL = 'sentinel-never-logged-sentinel-never-logged';
const models = AI.adapters.find((a) => a.id === 'anthropic')?.cost.models ?? {};

describe('src/ports.ts is tooling/ports/ai.json', () => {
  it('every feature, its adapter, its model, its effort and its INPUT CAP — and nothing else', () => {
    const want = Object.fromEntries(Object.entries(AI.features).map(([f, ft]) => [f, { adapter: ft.adapter, model: ft.model, effort: ft.effort, maxInputTokens: ft.maxInputTokens }]));
    expect(AI_FEATURE_TABLE).toEqual(want);
    expect([...AI_FEATURES].sort()).toEqual(Object.keys(AI.features).sort());
    expect(aiLimits().maxInputTokens).toEqual(Object.fromEntries(Object.entries(AI.features).map(([f, ft]) => [f, ft.maxInputTokens])));
  });

  it("the candidate list is the registry's, for every feature", () => {
    for (const ft of Object.values(AI.features)) expect(ft.candidates).toEqual([...AI_MODEL_CANDIDATES]);
  });

  it("every model's price is the anthropic row's (asOf included) — the candidates AND every model a fallback reaches", () => {
    expect(Object.keys(AI_COST_MODEL).sort()).toEqual(Object.keys(models).sort());
    for (const [id, p] of Object.entries(models)) {
      const { source: _s, verify: _v, fallbacks: _f, ...prices } = p;
      const { verify: _mine, ...ours } = AI_COST_MODEL[id];
      expect(ours).toEqual(prices);
    }
  });

  it("each model's fallback chain is the registry's, and every model in it is priced", () => {
    const want = Object.fromEntries(Object.entries(models).filter(([, p]) => Array.isArray(p.fallbacks) && p.fallbacks.length).map(([id, p]) => [id, p.fallbacks]));
    expect(AI_FALLBACKS).toEqual(want);
    for (const chain of Object.values(AI_FALLBACKS)) for (const m of chain) expect(AI_COST_MODEL[m]).toBeDefined();
  });

  it('the server adapters declare the capabilities the registry lists (one source: this assertion)', () => {
    const declared = (id: string) => [...(AI.adapters.find((a) => a.id === id)?.capabilities ?? [])].sort();
    expect([...createAnthropicAi({ apiKey: SENTINEL, limits: aiLimits() }).capabilities].sort()).toEqual(declared('anthropic'));
    expect([...createStubAi({ limits: aiLimits() }).capabilities].sort()).toEqual(declared('stub'));
  });

  it('costUsd prices a call from the table: Opus 5.5 at 3,000 in and 500 out is 0.022 USD', () => {
    expect(costUsd(AI_COST_MODEL, 'claude-opus-5-5', { inputTokens: 3000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(0.022, 12);
    expect(costUsd(AI_COST_MODEL, 'claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBeCloseTo(0.2, 12);
    expect(costUsd(AI_COST_MODEL, 'not-a-model', { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });
});

describe('aiFor — CUSTOMER-PAYS: no provider without a model, an input cap, a meter and a key', () => {
  it('today every feature has no model yet, so nothing can call a model even with a meter and a key', () => {
    for (const f of AI_FEATURES) {
      const sel = aiFor(f, { NIKATRU_ANTHROPIC_API_KEY: SENTINEL }, { beforeCall: GRANT });
      expect(sel).toEqual({ ok: false, detail: `ai: feature ${f} has no model yet (tooling/ports/ai.json features.${f}.model)` });
    }
  });

  it('🔴 with a model set, no meter still means no provider — and with a meter, the provider calls through it', async () => {
    const row = AI_FEATURE_TABLE.import as { adapter: 'anthropic'; model: string | null; effort: string | null; maxInputTokens: number | null };
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
  }, 20_000);

  it('🔴 a feature with a model but NO input cap builds no provider: a call could not be reserved at its worst case', () => {
    const row = AI_FEATURE_TABLE.review as { adapter: 'anthropic'; model: string | null; effort: string | null; maxInputTokens: number | null };
    const saved = row.model;
    try {
      row.model = 'claude-haiku-4-5';
      expect(row.maxInputTokens).toBeNull();
      expect(aiFor('review', { NIKATRU_ANTHROPIC_API_KEY: SENTINEL }, { beforeCall: GRANT })).toEqual({
        ok: false,
        detail: 'ai: feature review has no input cap (tooling/ports/ai.json features.review.maxInputTokens), so no provider is built',
      });
    } finally {
      row.model = saved;
    }
  });
});

describe("🔴 the import cap admits the feature's own declared call, and nothing over it", () => {
  // The declared call (ai.json features.import.tokensPerCall.input, 3,000 tokens of instructions
  // and paste) at about 4 bytes per token — the ratio and its source are at src/ports.ts
  // AI_FEATURE_TABLE — plus one screenshot, on the most expensive chain (Opus 5.5 and its fallbacks).
  const declared = (extraBytes = 0): AiRequest => ({
    ...conformanceRequest('claude-opus-5-5'),
    system: 's'.repeat(2_000),
    input: 'p'.repeat(10_000 + extraBytes),
    images: [{ mediaType: 'image/png', base64: 'iVBORw0KGgo=' }],
  });
  const cap = AI_FEATURE_TABLE.import.maxInputTokens as number;

  it('the declared call plus one screenshot is reserved', async () => {
    expect(new TextEncoder().encode(declared().system + declared().input).length).toBe(3_000 * 4);
    expect(estimateInputTokens(declared())).toBeLessThanOrEqual(cap);
    expect(await reserveOrRefuse('fixture', GRANT, declared(), aiLimits())).toMatchObject({ id: 'reservation-1' });
  });

  it('one byte over the cap is refused before the meter', async () => {
    const over = declared(cap - estimateInputTokens(declared()) + 1);
    expect(estimateInputTokens(over)).toBe(cap + 1);
    let asked = 0;
    const out = await reserveOrRefuse('fixture', async () => { asked++; return { ok: true, id: 'r' }; }, over, aiLimits());
    expect(out).toMatchObject({ ok: false, kind: 'invalid', billing: { known: true, attempts: [] } });
    expect(asked).toBe(0);
  });
});
