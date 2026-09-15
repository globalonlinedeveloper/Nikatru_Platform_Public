import { describe, it, expect } from 'vitest';
import {
  revenuecatVerifier,
  revenueCatSignature,
  parseRevenueCatSignatureHeader,
  REVENUECAT_REPLAY_TOLERANCE_SECONDS,
} from '../src/lib/mor/revenuecat';
import { verifierFor, MOR_VERIFIERS } from '../src/lib/mor/registry';
// Side-effect import: the harness installs `crypto.subtle.timingSafeEqual`, the
// Workers extension Node's WebCrypto lacks — without it a refusal and a crash
// print the same red (razorpay-verifier.test.ts says why at length).
import './harness';

// ─────────────────────────────────────────────────────────────────────────────
// revenuecat-verifier.test.ts — the store rails' webhook check on the one door
// (O-REVENUECAT-VERIFIER).
//
// 🔴 THE VECTORS ARE COMPUTED HERE, NOT TAKEN FROM THE SUBJECT: every positive
// case builds its digest with an INDEPENDENT WebCrypto call in this file, so the
// adapter and this file must agree on algorithm, key, message and encoding.
//
// Pinned, from revenuecat.com/docs/integrations/webhooks (read 2026-09-15):
// `X-RevenueCat-Webhook-Signature: t=<unix_timestamp>,v1=<hmac_sha256_hex>`,
// HMAC-SHA256 over `"<timestamp>.<raw_json_body>"` with the signing secret, `t` in
// unix seconds, and a replay tolerance of the vendor's own example, 5 minutes.
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = 'rc_signing_secret_for_tests';
const BODY = '{"api_version":"1.0","event":{"id":"evt_1","type":"RENEWAL","event_timestamp_ms":1757900000000}}';
const NOW_MS = 1_757_900_000_000;
const T = Math.floor(NOW_MS / 1000);

/** The digest, computed independently of the subject. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const headersWith = (value: string) => new Headers({ 'X-RevenueCat-Webhook-Signature': value });
const signed = async (t = T, body = BODY, secret = SECRET) => headersWith(`t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`);

describe('revenuecat verify — the signature scheme, from the primary source', () => {
  it('accepts a digest over `${t}.${rawBody}` with the signing secret as the key', async () => {
    expect(await revenuecatVerifier.verify(BODY, await signed(), SECRET, NOW_MS)).toEqual({ ok: true });
  });

  it('the adapter and an independent HMAC agree, digit for digit', async () => {
    expect(await revenueCatSignature(SECRET, T, BODY)).toBe(await hmacHex(SECRET, `${T}.${BODY}`));
  });

  // 🔴 THE SEPARATOR IS A DOT. Paddle signs `${ts}:${body}`; copying that here would
  // reject every genuine RevenueCat delivery in production.
  it("refuses a digest computed the Paddle way, over `t:body`", async () => {
    const wrong = headersWith(`t=${T},v1=${await hmacHex(SECRET, `${T}:${BODY}`)}`);
    expect(await revenuecatVerifier.verify(BODY, wrong, SECRET, NOW_MS)).toEqual({
      ok: false,
      status: 401,
      reason: 'signature does not match',
    });
  });

  it('refuses a digest over the body alone — the timestamp is part of what is signed', async () => {
    const wrong = headersWith(`t=${T},v1=${await hmacHex(SECRET, BODY)}`);
    expect(await revenuecatVerifier.verify(BODY, wrong, SECRET, NOW_MS)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses a body altered by one character', async () => {
    const tampered = BODY.replace('RENEWAL', 'RENEWAM');
    expect(await revenuecatVerifier.verify(tampered, await signed(), SECRET, NOW_MS)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('refuses a signed timestamp swapped for another — t is inside the digest', async () => {
    const sig = await hmacHex(SECRET, `${T}.${BODY}`);
    const moved = headersWith(`t=${T + 1},v1=${sig}`);
    expect(await revenuecatVerifier.verify(BODY, moved, SECRET, NOW_MS)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses a digest made with a different secret', async () => {
    expect(await revenuecatVerifier.verify(BODY, await signed(T, BODY, 'someone_elses'), SECRET, NOW_MS)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('accepts the fields in either order, and upper-case hex', async () => {
    const sig = (await hmacHex(SECRET, `${T}.${BODY}`)).toUpperCase();
    expect(await revenuecatVerifier.verify(BODY, headersWith(`v1=${sig},t=${T}`), SECRET, NOW_MS)).toEqual({ ok: true });
  });
});

describe('revenuecat verify — the replay window, the vendor\'s own five minutes, both directions', () => {
  it('is 300 seconds', () => {
    expect(REVENUECAT_REPLAY_TOLERANCE_SECONDS).toBe(300);
  });

  it('accepts a delivery exactly at the edge of the window, early or late', async () => {
    const edge = REVENUECAT_REPLAY_TOLERANCE_SECONDS;
    expect(await revenuecatVerifier.verify(BODY, await signed(T - edge), SECRET, NOW_MS)).toEqual({ ok: true });
    expect(await revenuecatVerifier.verify(BODY, await signed(T + edge), SECRET, NOW_MS)).toEqual({ ok: true });
  });

  it('refuses one second past it, in the past AND in the future, before spending a digest', async () => {
    const past = T - REVENUECAT_REPLAY_TOLERANCE_SECONDS - 1;
    const future = T + REVENUECAT_REPLAY_TOLERANCE_SECONDS + 1;
    const a = await revenuecatVerifier.verify(BODY, await signed(past), SECRET, NOW_MS);
    const b = await revenuecatVerifier.verify(BODY, await signed(future), SECRET, NOW_MS);
    expect(a).toMatchObject({ ok: false, status: 401 });
    expect(b).toMatchObject({ ok: false, status: 401 });
    if (!a.ok) expect(a.reason).toMatch(/outside the 300s tolerance/);
  });

  it('reads t as SECONDS — the same t against a millisecond clock of that instant is fresh', async () => {
    expect(await revenuecatVerifier.verify(BODY, await signed(T), SECRET, T * 1000 + 999)).toEqual({ ok: true });
  });
});

describe('revenuecat verify — the three refusals stay distinct', () => {
  it('503 when the seam is not configured, never 401', async () => {
    expect(await revenuecatVerifier.verify(BODY, await signed(), '', NOW_MS)).toEqual({
      ok: false,
      status: 503,
      reason: 'no destination secret configured',
    });
  });

  it('401 when the header is absent — a caller that signed nothing', async () => {
    expect(await revenuecatVerifier.verify(BODY, new Headers(), SECRET, NOW_MS)).toMatchObject({ ok: false, status: 401 });
  });

  it('401 for a bearer-style Authorization header alone — that is not the signature', async () => {
    const h = new Headers({ Authorization: `Bearer ${SECRET}` });
    expect(await revenuecatVerifier.verify(BODY, h, SECRET, NOW_MS)).toMatchObject({ ok: false, status: 401 });
  });

  for (const [what, header] of [
    ['missing t', `v1=${'a'.repeat(64)}`],
    ['missing v1', `t=${T}`],
    ['t not an integer', `t=12.5,v1=${'a'.repeat(64)}`],
    ['v1 not hex', `t=${T},v1=${'z'.repeat(64)}`],
    ['v1 too short', `t=${T},v1=abc123`],
    ['Paddle-shaped (; separated)', `t=${T};v1=${'a'.repeat(64)}`],
    ['implausibly long', `t=${T},v1=${'a'.repeat(600)}`],
  ] as const) {
    it(`400 when the header is ${what} — malformed is not the same as wrong`, async () => {
      expect(await revenuecatVerifier.verify(BODY, headersWith(header), SECRET, NOW_MS)).toMatchObject({
        ok: false,
        status: 400,
      });
    });
  }

  it('the header parser ignores an unknown field, so a future v2 does not break v1', () => {
    const r = parseRevenueCatSignatureHeader(`t=${T},v2=whatever,v1=${'b'.repeat(64)}`);
    expect(r).toEqual({ ok: true, t: T, v1: 'b'.repeat(64) });
  });
});

describe('revenuecat parse — refuses rather than guesses', () => {
  it('refuses, and the reason names the four undecided row facts and what is already enforced', () => {
    const r = revenuecatVerifier.parse(BODY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/signature is verified/);
    expect(r.reason).toMatch(/contracts\/entitlement\/contract\.js/);
    expect(r.reason).toMatch(/\(A\) which of OUR app ids/);
    expect(r.reason).toMatch(/\(B\)/);
    expect(r.reason).toMatch(/\(C\) the refund reading/);
    expect(r.reason).toMatch(/\(D\)/);
  });

  it('refuses an empty body and a well-formed event alike — it is not shape-sensitive yet', () => {
    expect(revenuecatVerifier.parse('').ok).toBe(false);
    expect(revenuecatVerifier.parse(BODY).ok).toBe(false);
  });
});

describe('revenuecat in the registry', () => {
  it('is reachable by its provider id — the same `revenuecat` the legacy writer stamps — and names its own secret', () => {
    const v = verifierFor('revenuecat');
    expect(v).not.toBeNull();
    expect(v?.provider).toBe('revenuecat');
    expect(v?.secretEnvVar).toBe('REVENUECAT_WEBHOOK_SIGNING_SECRET');
  });

  it('joins the other rails rather than replacing one', () => {
    const providers = MOR_VERIFIERS.map((v) => v.provider);
    expect(providers).toEqual(expect.arrayContaining(['paddle', 'razorpay', 'revenuecat']));
  });

  it('its secret is NOT the legacy bearer variable — the signing secret is a different value by the vendor\'s account', () => {
    expect(verifierFor('revenuecat')?.secretEnvVar).not.toBe('REVENUECAT_WEBHOOK_SECRET');
  });
});
