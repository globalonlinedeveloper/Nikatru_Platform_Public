// ai-anthropic-presend.test.ts — an error BEFORE the request is handed to the
// SDK ran nothing. Here the SDK itself fails to load (a dynamic import that
// rejects), so the adapter never reaches `client.beta.messages.create`: the
// outcome is `invalid` with `billing: {known: true, attempts: []}` and settles at
// zero, while the reservation it holds is still named for the meter to release.
// Its own file because the SDK mock is module-wide; the after-send side (an
// unparseable 200, billing unknown) is in ai-anthropic.conformance.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { CONFORMANCE_LIMITS, CONFORMANCE_PRICES, conformanceRequest, recordingGrant } from '../../_shared/test/conformance/ai';
import { settle, type AiReservationRequest } from '../../_shared/src/ports/ai';
import { createAnthropicAi } from '../src/adapters/ai/anthropic';

vi.mock('@anthropic-ai/sdk', () => {
  throw new Error('fixture: the SDK failed to load');
});

describe('🔴 an error before the request leaves is nothing-ran', () => {
  it('the SDK failing to load: invalid, known with no attempts, and it settles at zero', async () => {
    const reservations: AiReservationRequest[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const out = await createAnthropicAi({ apiKey: 'sentinel', beforeCall: recordingGrant(reservations), limits: CONFORMANCE_LIMITS, fetchImpl }).complete(conformanceRequest());
    expect(reservations).toHaveLength(1);
    expect(calls).toBe(0);
    expect(out).toMatchObject({ ok: false, kind: 'invalid', billing: { known: true, attempts: [] }, reservationId: 'reservation-1' });
    expect(settle(CONFORMANCE_PRICES, out.reservedUsd ?? 0, out)).toEqual({ chargeUsd: 0, releaseUsd: out.reservedUsd, basis: 'attempts' });
  });
});
