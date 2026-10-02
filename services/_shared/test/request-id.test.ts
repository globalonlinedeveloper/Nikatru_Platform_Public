import { describe, it, expect } from 'vitest';
import { REQUEST_ID_SHAPE, acceptRequestId, requestId } from '../src/request-id';

// ─────────────────────────────────────────────────────────────────────────────
// request-id.test.ts — the caller's `x-request-id` is kept only when it is a
// plain token of 1–64 characters; anything else is replaced by a fresh uuid.
// ⏱ 2026-10-01 · services-018. Each carrier's own suite drives its REAL app with
// the same two refused values, so the wiring is proven where it is mounted.
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The three members the middleware touches, recording what it did. */
function fakeContext(supplied: string | undefined) {
  const seen: { set?: string; header?: string } = {};
  const c = {
    req: { header: (name: string) => (name.toLowerCase() === 'x-request-id' ? supplied : undefined) },
    set: (_key: 'requestId', value: string) => {
      seen.set = value;
    },
    header: (_name: string, value: string) => {
      seen.header = value;
    },
  };
  return { c, seen };
}

describe('acceptRequestId', () => {
  it('keeps a plain token: a uuid, a trace id, a ray id', () => {
    for (const id of ['3f2c1a7e-9b1d-4c2e-8f00-1234567890ab', '0af7651916cd43dd8448eb211c80319c', '8a1b2c3d4e5f6789-BOM', 'a.b_c:d-e']) {
      expect(acceptRequestId(id)).toBe(id);
    }
  });

  it('🔴 replaces anything else with a FRESH uuid — never truncates, never cleans', () => {
    const long = 'a'.repeat(500);
    for (const bad of ['a@b.c', long, '', 'with space', 'new\nline', 'a'.repeat(65)]) {
      const got = acceptRequestId(bad);
      expect(got).toMatch(UUID);
      expect(got).not.toBe(bad);
    }
    expect(acceptRequestId(undefined)).toMatch(UUID);
    expect(REQUEST_ID_SHAPE.test('a'.repeat(64))).toBe(true);
  });
});

describe('requestId middleware', () => {
  it('sets and echoes the SAME accepted id, then calls next', async () => {
    const { c, seen } = fakeContext('rid-1');
    let called = false;
    await requestId(c, async () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(seen).toEqual({ set: 'rid-1', header: 'rid-1' });
  });

  it('🔴 a refused id is replaced in the context AND in the echo', async () => {
    for (const bad of ['a@b.c', 'x'.repeat(500)]) {
      const { c, seen } = fakeContext(bad);
      await requestId(c, async () => {});
      expect(seen.set).toMatch(UUID);
      expect(seen.header).toBe(seen.set);
    }
  });
});
