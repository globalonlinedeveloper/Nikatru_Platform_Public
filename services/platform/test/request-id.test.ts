import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import type { AppEnv } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// request-id.test.ts — this Worker mounts the kit's request-id middleware, so a
// caller's `x-request-id` is kept only when it is a plain token.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-018).
// The id was taken WHOLE from the caller, echoed, written into every
// `rid=` log line and sent to GlitchTip as the `request_id` tag. The rule is
// services/_shared/src/request-id.ts; its own cases run in
// services/_shared/test/request-id.test.ts. This file proves the MOUNTING,
// through the real app: 🔴 RED with the old inline middleware put back.
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const env = {} as AppEnv['Bindings'];

describe('x-request-id through the real app', () => {
  it('a plain caller id is echoed back unchanged', async () => {
    const res = await app.request('/no-such-route', { headers: { 'x-request-id': 'rid-123' } }, env);
    expect(res.headers.get('x-request-id')).toBe('rid-123');
  });

  it('🔴 `a@b.c` and a 500-character id are each replaced by a fresh uuid, echoed back', async () => {
    const seen = new Set<string>();
    for (const bad of ['a@b.c', 'x'.repeat(500)]) {
      const res = await app.request('/no-such-route', { headers: { 'x-request-id': bad } }, env);
      const echoed = res.headers.get('x-request-id') ?? '';
      expect(echoed).toMatch(UUID);
      seen.add(echoed);
    }
    expect(seen.size).toBe(2);
  });
});
