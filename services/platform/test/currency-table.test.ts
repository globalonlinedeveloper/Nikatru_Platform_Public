import { describe, it, expect } from 'vitest';
import { minorDigits, priceLabel } from '../src/lib/reminders';
import { MINOR_UNIT_DIGITS, toMinorUnits } from '../../../contracts/currency/iso4217.js';

// ─────────────────────────────────────────────────────────────────────────────
// THE REMINDER PRICE READS THE ONE ISO 4217 TABLE (lane fix-st-api-bounds,
// #1118 review finding 3).
//
// This Worker printed reminder prices from a map of its own while
// packages/core's Money wrote them from a two-entry one, so the two halves of
// one amount disagreed for every currency outside JPY and KWD: a KRW plan
// written as won × 100 mailed 100× too high, a BHD plan 10× too low. Both now
// read contracts/currency/iso4217.js; these are the round trips through the
// write rule (toMinorUnits — what subscriptiontracker-api checks `price_minor`
// against) and back out through the mail's label.
// ─────────────────────────────────────────────────────────────────────────────

describe('reminder prices use the shared ISO 4217 table', () => {
  it('KRW: no minor unit — 14900 won is written as 14900 and printed as 14900', () => {
    const minor = toMinorUnits(14900, 'KRW');
    expect(minor).toBe(14900);
    expect(priceLabel(14900, 'KRW', minor)).toBe('KRW 14900');
    expect(priceLabel(14900, 'KRW', null)).toBe('KRW 14900');
  });

  it('BHD: three minor digits — 2.5 dinar is written as 2500 and printed as 2.500', () => {
    const minor = toMinorUnits(2.5, 'BHD');
    expect(minor).toBe(2500);
    expect(priceLabel(2.5, 'BHD', minor)).toBe('BHD 2.500');
    expect(priceLabel(2.5, 'BHD', null)).toBe('BHD 2.500');
  });

  it('every code the table holds is the digits this formatter prints with', () => {
    const codes = Object.keys(MINOR_UNIT_DIGITS);
    expect(codes.length).toBeGreaterThan(150);
    for (const code of codes) expect(minorDigits(code), code).toBe(MINOR_UNIT_DIGITS[code]);
  });

  it('a code outside the table still prints, with two digits', () => {
    expect(minorDigits('ZZZ')).toBe(2);
  });
});
