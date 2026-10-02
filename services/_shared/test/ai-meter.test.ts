// ai-meter.test.ts — the arithmetic T17's meter settles with (src/ports/ai.ts):
// the input bound, the worst-case reservation, and settlement. Every number is a
// hand computation written beside it.
import { describe, expect, it } from 'vitest';
import {
  IMAGE_TOKEN_CEILING,
  REQUEST_OVERHEAD_TOKENS,
  aiNoAnswerOutcome,
  attemptsUsd,
  estimateInputTokens,
  settle,
  worstCaseUsd,
  type AiOutcome,
} from '../src/ports/ai';
import { CONFORMANCE_PRICES, FALLBACK_ATTEMPTS, FALLBACK_CHARGE_USD, conformanceRequest } from './conformance/ai';

describe('the input bound is an over-estimate from bytes', () => {
  it('counts UTF-8 bytes (never fewer than the tokens), the schema, a ceiling per image and the framing', () => {
    const req = { ...conformanceRequest(), system: 'abc', input: 'é€', images: [{ mediaType: 'image/png' as const, base64: 'AA==' }] };
    // 'abc' = 3 bytes; 'é€' = 2 + 3 = 5 bytes; the schema's JSON bytes; one image ceiling; the overhead.
    const schemaBytes = new TextEncoder().encode(JSON.stringify(req.schema)).length;
    expect(estimateInputTokens(req)).toBe(3 + 5 + schemaBytes + IMAGE_TOKEN_CEILING + REQUEST_OVERHEAD_TOKENS);
  });
});

describe('the reservation is the worst case of the whole chain', () => {
  it('every attempt at the input cap (priced at the dearer of input and cache write) and the output cap', () => {
    // Opus 5.5:  8000 × max(4, 5) + 512 × 20 = 40,000 + 10,240 = 50,240
    // Opus 4.8:  8000 × max(5, 6.25) + 512 × 25 = 50,000 + 12,800 = 62,800
    // Opus 5:    the same as Opus 4.8                                 = 62,800
    // total 175,840 / 1e6 = 0.17584 USD
    expect(worstCaseUsd(CONFORMANCE_PRICES, ['claude-opus-5-5', 'claude-opus-4-8', 'claude-opus-5'], 8000, 512)).toBeCloseTo(0.17584, 12);
  });

  it('a chain that reaches an unpriced model has no worst case', () => {
    expect(worstCaseUsd(CONFORMANCE_PRICES, ['claude-opus-5-5', 'claude-unpriced'], 8000, 512)).toBeNull();
  });
});

describe('settling', () => {
  const answered = (attempts = FALLBACK_ATTEMPTS): AiOutcome => ({
    ok: true,
    output: {},
    stopReason: 'end_turn',
    usage: attempts[attempts.length - 1].usage,
    servedModel: attempts[attempts.length - 1].model,
    billing: { known: true, attempts },
    reservationId: 'r',
    reservedUsd: 0.17584,
  });

  it('charges every attempt at its own model and releases the rest of the reservation', () => {
    expect(attemptsUsd(CONFORMANCE_PRICES, FALLBACK_ATTEMPTS)).toBeCloseTo(FALLBACK_CHARGE_USD, 12);
    const st = settle(CONFORMANCE_PRICES, 0.17584, answered());
    expect(st.basis).toBe('attempts');
    expect(st.chargeUsd).toBeCloseTo(0.038, 12);
    expect(st.releaseUsd).toBeCloseTo(0.17584 - 0.038, 12);
  });

  it('🔴 a timed-out call is usage UNKNOWN and settles at its reservation — never at zero', () => {
    const out = aiNoAnswerOutcome('fixture', Object.assign(new Error('t'), { name: 'TimeoutError' }), 'r', 0.17584);
    expect(out).toMatchObject({ ok: false, kind: 'timeout', billing: { known: false } });
    expect(settle(CONFORMANCE_PRICES, 0.17584, out)).toEqual({ chargeUsd: 0.17584, releaseUsd: 0, basis: 'reservation' });
  });

  it('an attempt on an unpriced model is charged at the reservation, never guessed', () => {
    const st = settle(CONFORMANCE_PRICES, 0.17584, answered([{ model: 'claude-unpriced', usage: FALLBACK_ATTEMPTS[0].usage }]));
    expect(st).toEqual({ chargeUsd: 0.17584, releaseUsd: 0, basis: 'reservation' });
  });

  it('a refusal before the wire ran nothing and settles at zero', () => {
    const refused: AiOutcome = { ok: false, kind: 'invalid', retryable: false, billing: { known: true, attempts: [] }, detail: 'no cap' };
    expect(settle(CONFORMANCE_PRICES, 0, refused)).toEqual({ chargeUsd: 0, releaseUsd: 0, basis: 'attempts' });
  });
});
