import { describe, it, expect } from 'vitest';
import { requestGeo } from '../src/geo';

// ─────────────────────────────────────────────────────────────────────────────
// geo.test.ts — requestGeo, the one reader of `request.cf` (assert-ports limb
// 10). Each field passes through only with the type the runtime documents; a
// missing or odd `cf` is an empty answer, never a throw.
// ─────────────────────────────────────────────────────────────────────────────

const req = (cf: unknown) => Object.assign(new Request('https://x.test/'), { cf });

describe('requestGeo', () => {
  it('reads country, region, city, colo and asn from request.cf', () => {
    expect(requestGeo(req({ country: 'IN', region: 'Tamil Nadu', city: 'Chennai', colo: 'MAA', asn: 13335 }))).toEqual({
      country: 'IN',
      region: 'Tamil Nadu',
      city: 'Chennai',
      colo: 'MAA',
      asn: 13335,
    });
  });

  it('a request without cf is an empty answer', () => {
    expect(requestGeo(new Request('https://x.test/'))).toEqual({});
    expect(requestGeo(req(null))).toEqual({});
    expect(requestGeo(req('MAA'))).toEqual({});
  });

  it('a field of the wrong type is ABSENT, not coerced', () => {
    const g = requestGeo(req({ country: 7, colo: { x: 1 }, asn: true, city: 'Pune' }));
    expect(g).toEqual({ city: 'Pune' });
    expect('country' in g).toBe(false);
  });

  it('asn is kept as the runtime gave it, so the edge key applies its own bound', () => {
    expect(requestGeo(req({ asn: '64512' })).asn).toBe('64512');
    expect(requestGeo(req({ asn: 64512 })).asn).toBe(64512);
  });
});
