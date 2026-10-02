import { describe, it, expect } from 'vitest';
import { razorpayVerifier, razorpaySignature } from '../src/lib/mor/razorpay';
import { verifierFor, MOR_VERIFIERS } from '../src/lib/mor/registry';
// Side-effect import: the harness installs `crypto.subtle.timingSafeEqual`, a
// Cloudflare Workers extension Node's WebCrypto does not have. Without it the
// comparison THROWS, and on a money route "the tampered body was refused" and
// "the tampered body crashed the Worker" print the same red - only one of which
// means the rail is safe. Its header says so at length; this is the same reason.
import './harness';

// ─────────────────────────────────────────────────────────────────────────────
// razorpay-verifier.test.ts — the India rail's signature check ([ADR 076]).
//
// 🔴 THE VECTORS ARE COMPUTED HERE, NOT TAKEN FROM THE SUBJECT. Asking the
// adapter for the expected digest and then asserting it matches itself would pass
// over any algorithm at all — including the wrong one. Every positive case below
// builds its digest with an INDEPENDENT WebCrypto call written out in this file,
// so the two implementations have to agree about the algorithm, the key, the
// message and the encoding before anything is green.
//
// What is being pinned, from razorpay.com's own documentation (read 2026-09-12):
// HMAC-SHA256, the webhook secret as the key, THE RAW BODY as the message, a hex
// digest, in the `X-Razorpay-Signature` header.
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = 'whsec_a_test_secret_value';
const BODY = '{"entity":"event","event":"subscription.charged","created_at":1757650000}';

/** The digest, computed independently of the subject. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const headersWith = (sig: string) => new Headers({ 'X-Razorpay-Signature': sig });

describe('razorpay verify — the signature scheme, from the primary source', () => {
  it('accepts a digest computed over the RAW BODY with the secret as the key', async () => {
    const sig = await hmacHex(SECRET, BODY);
    const r = await razorpayVerifier.verify(BODY, headersWith(sig), SECRET, Date.now());
    expect(r).toEqual({ ok: true });
  });

  it('the adapter and an independent HMAC agree, digit for digit', async () => {
    expect(await razorpaySignature(SECRET, BODY)).toBe(await hmacHex(SECRET, BODY));
  });

  // 🔴 THE MESSAGE IS THE BODY ALONE. Paddle signs `${ts}:${body}`; copying that
  // shape here would verify nothing Razorpay ever sends, and the failure would be
  // every genuine notification rejected in production.
  it('refuses a digest computed the SIBLING rail\'s way, over `ts:body`', async () => {
    const wrong = await hmacHex(SECRET, `1757650000:${BODY}`);
    const r = await razorpayVerifier.verify(BODY, headersWith(wrong), SECRET, Date.now());
    expect(r).toEqual({ ok: false, status: 401, reason: 'signature does not match' });
  });

  it('refuses a body altered by one character', async () => {
    const sig = await hmacHex(SECRET, BODY);
    const tampered = BODY.replace('1757650000', '1757650001');
    const r = await razorpayVerifier.verify(tampered, headersWith(sig), SECRET, Date.now());
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses a digest made with a different secret', async () => {
    const sig = await hmacHex('whsec_someone_elses_secret', BODY);
    const r = await razorpayVerifier.verify(BODY, headersWith(sig), SECRET, Date.now());
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it('accepts the digest in either case — hex is hex', async () => {
    const sig = (await hmacHex(SECRET, BODY)).toUpperCase();
    const r = await razorpayVerifier.verify(BODY, headersWith(sig), SECRET, Date.now());
    expect(r).toEqual({ ok: true });
  });

  // ⏱ NO TIMESTAMP IS SIGNED, so `nowMs` cannot matter. If a replay window is ever
  // added it must come from a sourced fact, not from this parameter being present.
  it('is indifferent to the clock, because Razorpay signs no timestamp', async () => {
    const sig = await hmacHex(SECRET, BODY);
    const longAgo = await razorpayVerifier.verify(BODY, headersWith(sig), SECRET, 0);
    const faraway = await razorpayVerifier.verify(BODY, headersWith(sig), SECRET, 4_102_444_800_000);
    expect(longAgo).toEqual({ ok: true });
    expect(faraway).toEqual({ ok: true });
  });
});

describe('razorpay verify — the three refusals stay distinct', () => {
  it('503 when the seam is not configured, never 401', async () => {
    const r = await razorpayVerifier.verify(BODY, headersWith('x'.repeat(64)), '', Date.now());
    expect(r).toEqual({ ok: false, status: 503, reason: 'no destination secret configured' });
  });

  it('401 when the header is absent — a caller that signed nothing', async () => {
    const r = await razorpayVerifier.verify(BODY, new Headers(), SECRET, Date.now());
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  for (const [what, header] of [
    ['too short', 'abc123'],
    ['not hex', 'z'.repeat(64)],
    ['too long to be a digest', 'a'.repeat(600)],
  ] as const) {
    it(`400 when the header is ${what} — malformed is not the same as wrong`, async () => {
      const r = await razorpayVerifier.verify(BODY, headersWith(header), SECRET, Date.now());
      expect(r).toMatchObject({ ok: false, status: 400 });
    });
  }
});

// ⏱ 2026-10-01 · fix-india-rail-tax-data · `parse` maps subscription / refund / dispute bodies now
// (lib/mor/razorpay.ts header; the mapping's own tests are test/razorpay-rail.test.ts and the
// conformance suite). What stays here is the refusal half: no event id, or a body that is not the
// documented envelope, is still a 400 that writes nothing — never a guess.
describe('razorpay parse — still refuses what it cannot read', () => {
  it('refuses without the x-razorpay-event-id hint, and the reason names the header', () => {
    const r = razorpayVerifier.parse(BODY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/x-razorpay-event-id/);
  });

  it('refuses an empty body and an envelope with no payload, even with an event id', () => {
    expect(razorpayVerifier.parse('', 'evt_1').ok).toBe(false);
    expect(razorpayVerifier.parse('{"event":"subscription.charged"}', 'evt_1').ok).toBe(false);
    expect(razorpayVerifier.parse(BODY, 'evt_1').ok).toBe(false); // no `payload` object
  });
});

describe('razorpay in the registry', () => {
  it('is reachable by its provider id, and names its own secret', () => {
    const v = verifierFor('razorpay');
    expect(v).not.toBeNull();
    expect(v?.provider).toBe('razorpay');
    expect(v?.secretEnvVar).toBe('RAZORPAY_WEBHOOK_SECRET');
  });

  it('joins Paddle rather than replacing it — [ADR 076] keeps international on Paddle', () => {
    const providers = MOR_VERIFIERS.map((v) => v.provider);
    expect(providers).toContain('paddle');
    expect(providers).toContain('razorpay');
  });

  it('every registered rail names a DISTINCT secret variable', () => {
    const vars = MOR_VERIFIERS.map((v) => v.secretEnvVar);
    expect(new Set(vars).size).toBe(vars.length);
  });
});
