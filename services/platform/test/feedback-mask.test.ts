import { describe, expect, it } from 'vitest';
import { linkCount, maskPii } from '../src/feedback/mask';

// ─────────────────────────────────────────────────────────────────────────────
// feedback-mask.test.ts — lane feedback-intake, Do 2 (server half): the free text
// of a report is PII-masked BEFORE it is stored. The route test proves the stored
// row; this proves each shape on its own, so a regex narrowed for one shape
// reddens here by name.
// ─────────────────────────────────────────────────────────────────────────────

describe('🔴 [Do 2] maskPii masks every shape the brief names', () => {
  it('an e-mail address', () => {
    expect(maskPii('write to asha.k@example.co.in please')).not.toContain('asha.k@example.co.in');
  });
  it('a card-like run of digits, spaced or not', () => {
    for (const card of ['4111 1111 1111 1111', '4111-1111-1111-1111', '4111111111111111']) {
      expect(maskPii(`my card ${card} was charged`)).not.toContain(card);
    }
  });
  it('a phone number', () => {
    expect(maskPii('call +91 98765 43210 after six')).not.toMatch(/98765\s?43210/);
  });
  it('a UPI id', () => {
    expect(maskPii('paid to asha@okhdfcbank twice')).not.toContain('asha@okhdfcbank');
  });
  it('and leaves ordinary words and versions alone', () => {
    const plain = 'The add button does nothing on 1.4.0, every time.';
    expect(maskPii(plain)).toBe(plain);
  });
});

describe('linkCount', () => {
  it('counts http(s) links and nothing else', () => {
    expect(linkCount('see https://a.example and http://b.example, not ftp://c')).toBe(2);
    expect(linkCount('no links here')).toBe(0);
  });
});
