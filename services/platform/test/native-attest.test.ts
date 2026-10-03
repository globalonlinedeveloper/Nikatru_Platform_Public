// ─────────────────────────────────────────────────────────────────────────────
// native-attest.test.ts — the three proofs behind the native sign-in route
// (⏱ 2026-09-29, ADR no.NNN; src/lib/native-attest/).
//
// WHAT IS BEING PROVEN, each case the shape of a way this could be wrong:
//   · THE BINDING matches the wire protocol's published test vector, byte for
//     byte — the Dart client (packages/core native_attest.dart) asserts the same
//     literals: both runtimes are held to the one vector;
//   · APP ATTEST: a genuine attestation — a real certificate chain, built here
//     with a test CA because Apple signs nothing for a test — verifies, and the
//     SAME attestation is refused against the pinned Apple root (red control);
//     a wrong nonce, App ID, key, AAGUID or an expired chain is refused; an
//     assertion verifies once, and a replayed counter or other clientData does
//     not. At the ROUTE, an App Attest op passes with a genuine assertion and a
//     counter that does not move is refused;
//   · PLAY INTEGRITY: the verdict grader passes a genuine verdict and refuses
//     each field that is wrong; a classic token (JWE A256KW/A256GCM around a
//     JWS ES256, built here with fixture keys) is decrypted, verified and graded
//     LOCALLY (O-PLAY-INTEGRITY-LOCAL-VERIFY) — a wrong key, a tampered byte or
//     a foreign alg is refused, never 5xx; NO fetch leaves the Worker on any
//     Play path and NO daily counter is written; and at the ROUTE a verdict
//     answers only the request whose nonce it carries.
// Nothing here reaches a network: GoTrue is a fake behind `fetch`, and any other
// origin is recorded as a FOREIGN call that the Play tests assert never happens.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { app } from '../src/index';
import type { AppEnv, RateLimiterBinding } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';
import { bumpDailyCounter, clientDataFor, issueChallenge, requestTarget } from '../src/lib/native-attest';
import { b64url, concat, fromB64url, sha256 } from '../src/lib/native-attest/bytes';
import { APPLE_APP_ATTEST_ROOT_PEM, appleRootDer, verifyAssertion, verifyAttestation } from '../src/lib/native-attest/app-attest';
import { issuedBy, parseCertificate, pemToDer } from '../src/lib/native-attest/x509';
import { decodeCbor } from '../src/lib/native-attest/cbor';
import {
  AAGUID_DEV,
  APP_ID,
  NOW,
  TEAM,
  assertionFor,
  attestationFor,
  b64std,
  cbor,
  playFixtureKeys,
  playJwe,
  playJws,
  playToken,
  type PlayFixtureKeys,
} from './native-attest-fixtures';
import {
  gradeVerdict,
  parsePlayKeys,
  plausibleIntegrityToken,
  resetPlayIntegrityKeyCache,
  verifyPlayIntegrity,
  type CertPins,
  type PlayKeys,
} from '../src/lib/native-attest/play-integrity';

// ── the wire protocol's test vector (protocol v2: the proof covers path and query) ──
describe('the binding — the published vector, byte for byte', () => {
  const challenge = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  const body = new TextEncoder().encode('{"email":"a@example.test","password":"pw"}');
  const target = requestTarget(new URL('https://x.example/v1/auth/native/subscriptiontracker/token?grant_type=password'));

  it('clientData, target, bodyHash and requestHash are the vector\'s', async () => {
    expect(target).toBe('/v1/auth/native/subscriptiontracker/token?grant_type=password');
    const cd = await clientDataFor('subscriptiontracker', 'token', challenge, target, body);
    expect(cd).toBe(`nk-native-auth/v2\nsubscriptiontracker\ntoken\n${challenge}\n${target}\n6iU0klSWpvzudfyl590CwvA54eDW4neVBb9Nc2Uk35U`);
    expect(b64url(await sha256(cd))).toBe('OxAuf5vrL3xArivihIdBI7-GjML5J9Fb8l28ubtBYac');
    // Red controls: one byte of body, or a different query, changes the binding.
    const otherBody = await clientDataFor('subscriptiontracker', 'token', challenge, target, new TextEncoder().encode('{"email":"a@example.test","password":"pX"}'));
    expect(otherBody).not.toBe(cd);
    const otherQuery = await clientDataFor('subscriptiontracker', 'token', challenge, target.replace('password', 'pkce'), body);
    expect(otherQuery).not.toBe(cd);
  });

  it('the canonical target sorts and re-encodes the query, whatever order and encoding it arrived in', () => {
    const want =
      '/v1/auth/native/subscriptiontracker/signup?foo=b%20a%2Br&redirect_to=com.nikatru.subscriptiontracker%3A%2F%2Fauth-callback%3Fnk_auth%3Dconfirm';
    for (const q of [
      'redirect_to=com.nikatru.subscriptiontracker%3A%2F%2Fauth-callback%3Fnk_auth%3Dconfirm&foo=b+a%2Br',
      'foo=b%20a%2Br&redirect_to=com.nikatru.subscriptiontracker://auth-callback?nk_auth%3Dconfirm',
    ]) {
      expect(requestTarget(new URL(`https://x.example/v1/auth/native/subscriptiontracker/signup?${q}`)), q).toBe(want);
    }
    expect(requestTarget(new URL('https://x.example/v1/auth/native/subscriptiontracker/attest/install'))).toBe(
      '/v1/auth/native/subscriptiontracker/attest/install',
    );
  });

  it('the Ed25519 vector: seed 32×0x07 gives the vector\'s key id and signature', async () => {
    const pkcs8 = concat(Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]), new Uint8Array(32).fill(7));
    const priv = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
    const cd = await clientDataFor('subscriptiontracker', 'token', challenge, target, body);
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, priv, new TextEncoder().encode(cd)));
    expect(b64url(sig)).toBe('WOSt3gJcbYAB3xE8nnRjK7WYZKBy4xmc6H4WIRce6RzC9b_WyHtdIl5vucGMk0wAnXlM1fqsYxAasbFASMR_BA');
    const pub = fromB64url('6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw')!;
    expect(b64url(await sha256(pub))).toBe('_oEsEvOrTOasXbaaw1L5BssbEe9D-zPiUu9_9VImOIk');
  });
});

// ── the CBOR reader refuses rather than guesses (attacker bytes, unauthenticated route) ──
describe('decodeCbor — refuses what it does not understand', () => {
  it('reads the shapes App Attest uses: maps, text, bytes, arrays, small and large integers', () => {
    const m = decodeCbor(Uint8Array.from([0xa2, 0x61, 0x61, 0x42, 1, 2, 0x61, 0x62, 0x82, 0x18, 0xff, 0x20]));
    expect(m).toBeInstanceOf(Map);
    expect((m as Map<string, unknown>).get('a')).toEqual(Uint8Array.from([1, 2]));
    expect((m as Map<string, unknown>).get('b')).toEqual([255, -1]);
  });
  it('🔴 throws on indefinite length, a tag, a float, truncation, trailing bytes, a duplicate key and deep nesting', () => {
    const cases: Array<[string, number[]]> = [
      ['indefinite', [0x5f, 0x41, 0x00, 0xff]],
      ['tag', [0xc0, 0x60]],
      ['float', [0xfb, 0, 0, 0, 0, 0, 0, 0, 0]],
      ['truncated', [0x44, 1, 2]],
      ['trailing', [0x01, 0x02]],
      ['duplicate key', [0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02]],
      ['too deep', [0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x00]],
      ['huge length', [0x5b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]],
    ];
    for (const [why, bytes] of cases) expect(() => decodeCbor(Uint8Array.from(bytes)), why).toThrow();
  });
});

describe('App Attest — attestation (once per key) and assertion (every op)', () => {
  const policy = (root: Uint8Array, over: Partial<{ allowDevelopment: boolean; now: number; appId: string }> = {}) => ({
    appId: APP_ID,
    allowDevelopment: false,
    rootDer: root,
    now: NOW,
    ...over,
  });

  it('a genuine attestation verifies against its root and yields the credential key', async () => {
    const cdh = await sha256('install client data');
    const a = await attestationFor(cdh);
    const r = await verifyAttestation(a.attestation, a.keyId, cdh, policy(a.root));
    expect(r).toEqual({ ok: true, spki: a.spki });
  });

  it('🔴 red control: the SAME attestation against the PINNED APPLE ROOT is refused — a self-made CA cannot mint a key', async () => {
    const cdh = await sha256('install client data');
    const a = await attestationFor(cdh);
    expect(await verifyAttestation(a.attestation, a.keyId, cdh, policy(appleRootDer()))).toEqual({ ok: false, why: 'chain' });
  });

  it('🔴 refuses a wrong nonce, another App ID, another key id, a non-zero counter and an expired leaf', async () => {
    const cdh = await sha256('install client data');
    const a = await attestationFor(cdh);
    expect(await verifyAttestation(a.attestation, a.keyId, await sha256('another request'), policy(a.root))).toMatchObject({ ok: false, why: 'nonce' });
    expect(await verifyAttestation(a.attestation, a.keyId, cdh, policy(a.root, { appId: `ZZZZZ99999.com.nikatru.subscriptiontracker` }))).toMatchObject({
      ok: false,
      why: 'rpIdHash',
    });
    expect(await verifyAttestation(a.attestation, await sha256('other key'), cdh, policy(a.root))).toMatchObject({ ok: false, why: 'keyId' });
    const counted = await attestationFor(cdh, { counter: 1 });
    expect(await verifyAttestation(counted.attestation, counted.keyId, cdh, policy(counted.root))).toMatchObject({ ok: false, why: 'counter' });
    const expired = await attestationFor(cdh, { leafNotAfter: Date.UTC(2025, 0, 1) });
    expect(await verifyAttestation(expired.attestation, expired.keyId, cdh, policy(expired.root))).toMatchObject({ ok: false, why: 'chain' });
  });

  it('🔴 a DEVELOPMENT key is refused in production and accepted only where development is allowed (the sandbox)', async () => {
    const cdh = await sha256('install client data');
    const dev = await attestationFor(cdh, { aaguid: AAGUID_DEV });
    expect(await verifyAttestation(dev.attestation, dev.keyId, cdh, policy(dev.root))).toMatchObject({ ok: false, why: 'aaguid' });
    expect((await verifyAttestation(dev.attestation, dev.keyId, cdh, policy(dev.root, { allowDevelopment: true }))).ok).toBe(true);
  });

  it('refuses bytes that are not an attestation at all', async () => {
    const cdh = await sha256('x');
    for (const junk of [new Uint8Array(0), Uint8Array.of(0xff), cbor({ fmt: 'packed' }), cbor({ fmt: 'apple-appattest', attStmt: {}, authData: new Uint8Array(3) })]) {
      expect((await verifyAttestation(junk, new Uint8Array(32), cdh, policy(appleRootDer()))).ok).toBe(false);
    }
  });

  it('an assertion verifies once; 🔴 a counter that does not move, other clientData or another App ID is refused', async () => {
    const a = await attestationFor(await sha256('install'));
    const clientData = 'nk-native-auth/v1\nsubscriptiontracker\ntoken\nc\nb';
    const one = await assertionFor(a.leafKey, clientData, 1);
    expect(await verifyAssertion(one, a.spki, await sha256(clientData), APP_ID, 0)).toEqual({ ok: true, counter: 1 });
    expect(await verifyAssertion(one, a.spki, await sha256(clientData), APP_ID, 1)).toMatchObject({ ok: false, why: 'counter' });
    expect(await verifyAssertion(one, a.spki, await sha256('other client data'), APP_ID, 0)).toMatchObject({ ok: false, why: 'signature' });
    expect(await verifyAssertion(await assertionFor(a.leafKey, clientData, 2, 'X.other'), a.spki, await sha256(clientData), APP_ID, 1)).toMatchObject({
      ok: false,
      why: 'rpIdHash',
    });
  });

  it('the pinned root is Apple\'s, intact: its subject, its validity to 2045, and its own signature', async () => {
    const root = parseCertificate(pemToDer(APPLE_APP_ATTEST_ROOT_PEM));
    expect(new TextDecoder().decode(root.subject)).toContain('Apple App Attestation Root CA');
    expect(root.curve).toBe('P-384');
    expect(new Date(root.notAfter).toISOString()).toBe('2045-03-15T00:00:00.000Z');
    expect(await issuedBy(root, root, NOW)).toBe(true);
    // Red control: one flipped byte in the signed part breaks it.
    const tampered = pemToDer(APPLE_APP_ATTEST_ROOT_PEM);
    tampered[60] ^= 1;
    expect(await issuedBy(parseCertificate(tampered), root, NOW)).toBe(false);
  });
});

// ── Play Integrity ─────────────────────────────────────────────────────────────
const PKG = 'com.nikatru.subscriptiontracker';
const PLAY_DIGEST = 'AB:'.repeat(31) + 'AB';
const SIDELOAD_DIGEST = 'CD:'.repeat(31) + 'CD';
const toB64url = (colon: string) => b64url(Uint8Array.from(colon.split(':').map((h) => parseInt(h, 16))));
const PINS: CertPins = { play: [toB64url(PLAY_DIGEST)], sideload: [toB64url(SIDELOAD_DIGEST)] };

const verdict = (nonce: string, over: Record<string, unknown> = {}) => ({
  requestDetails: { requestPackageName: PKG, nonce, timestampMillis: String(Date.now()) },
  appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: PKG, certificateSha256Digest: [toB64url(PLAY_DIGEST)], versionCode: '42' },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
  ...over,
});

describe('Play Integrity — the verdict grader', () => {
  const H = 'vhEcb1KdwBN_Qi1H40RTtnWH4fDw60TeZxBYTwvGb8M';
  it('passes a genuine Play verdict, and a pinned sideload build\'s UNRECOGNIZED_VERSION verdict', () => {
    expect(gradeVerdict(verdict(H), PKG, H, PINS, Date.now())).toEqual({ ok: true, channel: 'play' });
    // Google may return the nonce padded or in standard base64; both are the same nonce.
    expect(gradeVerdict(verdict(`${H}=`), PKG, H, PINS, Date.now()).ok).toBe(true);
    const sideload = verdict(H, {
      appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: PKG, certificateSha256Digest: [toB64url(SIDELOAD_DIGEST)] },
    });
    expect(gradeVerdict(sideload, PKG, H, PINS, Date.now())).toEqual({ ok: true, channel: 'sideload' });
  });

  it('🔴 refuses each wrong field: nonce, package, recognition, digest, device, freshness', () => {
    const now = Date.now();
    const cases: Array<[string, unknown]> = [
      ['nonce', verdict('A'.repeat(43))],
      ['package', verdict(H, { requestDetails: { requestPackageName: 'com.evil.app', nonce: H, timestampMillis: String(now) } })],
      ['app', verdict(H, { appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: PKG, certificateSha256Digest: [toB64url(PLAY_DIGEST)] } })],
      ['app', verdict(H, { appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: PKG, certificateSha256Digest: [toB64url('EF:'.repeat(31) + 'EF')] } })],
      ['app', verdict(H, { appIntegrity: { appRecognitionVerdict: 'UNEVALUATED', packageName: PKG } })],
      ['device', verdict(H, { deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } })],
      ['device', verdict(H, { deviceIntegrity: {} })],
      ['timestamp', verdict(H, { requestDetails: { requestPackageName: PKG, nonce: H, timestampMillis: String(now - 10 * 60_000) } })],
    ];
    for (const [why, v] of cases) expect(gradeVerdict(v as never, PKG, H, PINS, now), why).toMatchObject({ ok: false, why });
    // A sideload build is refused while its channel has no pin (apps.gov.in today).
    const unpinned: CertPins = { play: PINS.play, sideload: [] };
    const sideload = verdict(H, {
      appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: PKG, certificateSha256Digest: [toB64url(SIDELOAD_DIGEST)] },
    });
    expect(gradeVerdict(sideload, PKG, H, unpinned, now).ok).toBe(false);
  });
});

// ── Play Integrity, decoded LOCALLY (O-PLAY-INTEGRITY-LOCAL-VERIFY) ─────────────
let keys: PlayFixtureKeys;
let other: PlayFixtureKeys;
const workerKeys = (k: PlayFixtureKeys): PlayKeys => parsePlayKeys(k.decryptionB64, k.verificationB64)!;

/** Every fetch that is not GoTrue: the Play path must make NONE (auth-04 — the artefact that says which path ran). */
let foreign: string[];
let gotrueSeen: number;
const SUPABASE_URL = 'https://native-attest-test.gotrue.example';

beforeAll(async () => {
  keys = await playFixtureKeys();
  other = await playFixtureKeys();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    // Routed by ORIGIN, never by string prefix (CodeQL js/incomplete-url-substring-sanitization).
    if (new URL(url).origin === new URL(SUPABASE_URL).origin) {
      gotrueSeen++;
      return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 'u', email_confirmed_at: null } }), { status: 200 });
    }
    foreign.push(url);
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  foreign = [];
  gotrueSeen = 0;
  resetPlayIntegrityKeyCache();
});

describe('Play Integrity — the local verifier (JWE A256KW/A256GCM → JWS ES256 → gradeVerdict)', () => {
  const H = 'vhEcb1KdwBN_Qi1H40RTtnWH4fDw60TeZxBYTwvGb8M';
  const sideloadVerdict = (nonce: string) =>
    verdict(nonce, {
      appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: PKG, certificateSha256Digest: [toB64url(SIDELOAD_DIGEST)] },
    });

  it('a token encrypted and signed with the fixture keys grades exactly as gradeVerdict grades its payload — Play and sideload', async () => {
    for (const [payload, channel] of [
      [verdict(H), 'play'],
      [sideloadVerdict(H), 'sideload'],
    ] as const) {
      const now = Date.now();
      const local = await verifyPlayIntegrity(await playToken(payload, keys), PKG, H, workerKeys(keys), PINS, now);
      expect(local).toEqual(gradeVerdict(payload, PKG, H, PINS, now));
      expect(local).toEqual({ ok: true, channel });
    }
    // And a refusal the grader makes is the refusal the verifier makes: the grade is not short-circuited.
    const wrongNonce = verdict('A'.repeat(43));
    expect(await verifyPlayIntegrity(await playToken(wrongNonce, keys), PKG, H, workerKeys(keys), PINS, Date.now())).toEqual({ ok: false, why: 'nonce' });
    expect(foreign).toEqual([]);
  });

  it('🔴 a wrong decryption key, a JWS signed by another key, and a tampered ciphertext, tag, IV, wrapped key or header are refused', async () => {
    const token = await playToken(verdict(H), keys);
    const wk = workerKeys(keys);
    // Another AES key: the CEK does not unwrap.
    expect(await verifyPlayIntegrity(token, PKG, H, { ...wk, decryption: workerKeys(other).decryption }, PINS, Date.now())).toEqual({ ok: false, why: 'decrypt' });
    // A valid JWE under OUR AES key, around a JWS signed by ANOTHER key.
    const forged = await playToken(verdict(H), { aes: keys.aes, signKey: other.signKey });
    expect(await verifyPlayIntegrity(forged, PKG, H, wk, PINS, Date.now())).toEqual({ ok: false, why: 'signature' });
    // One flipped character in each segment.
    const flip = (t: string, seg: number) => {
      const parts = t.split('.');
      const p = parts[seg]!;
      // Flip a MIDDLE character so the change lands on real bits, never on base64url padding bits.
      const at = Math.floor(p.length / 2);
      parts[seg] = p.slice(0, at) + (p[at] === 'A' ? 'B' : 'A') + p.slice(at + 1);
      return parts.join('.');
    };
    for (const [seg, name] of [
      [1, 'wrapped key'],
      [2, 'iv'],
      [3, 'ciphertext'],
      [4, 'tag'],
    ] as const) {
      const v = await verifyPlayIntegrity(flip(token, seg), PKG, H, wk, PINS, Date.now());
      expect(v, name).toMatchObject({ ok: false, why: 'decrypt' });
    }
    // The protected header is the AAD: an equivalent header, re-encoded, does not decrypt.
    const [, ...rest] = token.split('.');
    const reHeader = b64url(new TextEncoder().encode('{"enc":"A256GCM","alg":"A256KW"}'));
    expect(await verifyPlayIntegrity([reHeader, ...rest].join('.'), PKG, H, wk, PINS, Date.now())).toEqual({ ok: false, why: 'decrypt' });
    // The JWS must say ES256, and its payload must be a verdict object.
    const hs = await playJwe(await playJws(verdict(H), keys.signKey, { alg: 'HS256' }), keys.aes);
    expect(await verifyPlayIntegrity(hs, PKG, H, wk, PINS, Date.now())).toEqual({ ok: false, why: 'signature' });
    const notJws = await playJwe('not a jws', keys.aes);
    expect(await verifyPlayIntegrity(notJws, PKG, H, wk, PINS, Date.now())).toEqual({ ok: false, why: 'signature' });
    const arrayPayload = await playJwe(await playJws([1, 2], keys.signKey), keys.aes);
    expect(await verifyPlayIntegrity(arrayPayload, PKG, H, wk, PINS, Date.now())).toEqual({ ok: false, why: 'payload' });
    expect(foreign).toEqual([]);
  });

  it('🔴 an alg or enc other than A256KW / A256GCM is refused BEFORE any crypto runs', async () => {
    const jws = await playJws(verdict(H), keys.signKey);
    const tokens = [
      await playJwe(jws, keys.aes, { alg: 'A128KW', enc: 'A256GCM' }),
      await playJwe(jws, keys.aes, { alg: 'A256KW', enc: 'A128GCM' }),
      await playJwe(jws, keys.aes, { alg: 'dir', enc: 'A256GCM' }),
      await playJwe(jws, keys.aes, { alg: 'A256KW', enc: 'A256GCM', zip: 'DEF' }),
      await playJwe(jws, keys.aes, { alg: 'A256KW' }),
    ];
    const unwrap = vi.spyOn(crypto.subtle, 'unwrapKey');
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    try {
      for (const t of tokens) {
        expect(plausibleIntegrityToken(t)).toBe(false);
        expect(await verifyPlayIntegrity(t, PKG, H, workerKeys(keys), PINS, Date.now())).toEqual({ ok: false, why: 'token shape' });
      }
      expect(importKey).not.toHaveBeenCalled();
      expect(unwrap).not.toHaveBeenCalled();
      expect(decrypt).not.toHaveBeenCalled();
      // Green control: the same spies DO see a well-shaped token's crypto.
      expect((await verifyPlayIntegrity(await playJwe(jws, keys.aes), PKG, H, workerKeys(keys), PINS, Date.now())).ok).toBe(true);
      expect(unwrap).toHaveBeenCalledTimes(1);
      expect(decrypt).toHaveBeenCalledTimes(1);
    } finally {
      unwrap.mockRestore();
      decrypt.mockRestore();
      importKey.mockRestore();
    }
  });

  it('the shape check is Play\'s: five segments, a 54-char wrapped key, a 16-char IV, a 22-char tag', async () => {
    const good = await playToken(verdict(H), keys);
    expect(plausibleIntegrityToken(good)).toBe(true);
    const [h, w, iv, ct, tag] = good.split('.') as [string, string, string, string, string];
    expect([w.length, iv.length, tag.length]).toEqual([54, 16, 22]);
    for (const bad of [
      [h, w.slice(1), iv, ct, tag],
      [h, w, `${iv}AAAA`, ct, tag],
      [h, w, iv, ct, tag.slice(1)],
      [h, w, iv, '', tag],
      [h, w, iv, ct],
      [h, w, iv, ct, tag, tag],
      [h, w, iv, `${ct.slice(0, -1)}+`, tag],
    ]) {
      expect(plausibleIntegrityToken(bad.join('.')), bad.map((p) => p.length).join(',')).toBe(false);
    }
  });

  it('the two secrets parse only as Play Console issues them: 32 AES bytes and a P-256 SPKI, standard base64', async () => {
    expect(parsePlayKeys(keys.decryptionB64, keys.verificationB64)).not.toBeNull();
    const p384 = b64std(new Uint8Array((await crypto.subtle.exportKey('spki', ((await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign'])) as CryptoKeyPair).publicKey)) as ArrayBuffer));
    for (const [d, v, why] of [
      [undefined, keys.verificationB64, 'no decryption key'],
      [keys.decryptionB64, undefined, 'no verification key'],
      [b64std(new Uint8Array(16)), keys.verificationB64, 'a 128-bit AES key'],
      [keys.decryptionB64, p384, 'a P-384 key'],
      [keys.decryptionB64, keys.decryptionB64, 'the AES key twice'],
      ['not base64!', keys.verificationB64, 'not base64'],
    ] as const) {
      expect(parsePlayKeys(d, v), why).toBeNull();
    }
  });
});

// ── the ROUTE, for App Attest and Play Integrity ──────────────────────────────
class Limiter implements RateLimiterBinding {
  calls = 0;
  constructor(private readonly cap = Number.POSITIVE_INFINITY) {}
  async limit(): Promise<{ success: boolean }> {
    return { success: ++this.calls <= this.cap };
  }
}
let playVerify = new Limiter();

const BASE = '/v1/auth/native/subscriptiontracker';

let db: RealDb;

beforeEach(() => {
  db = realPlatformDb();
  playVerify = new Limiter();
});

function env(over: Partial<AppEnv['Bindings']> = {}): AppEnv['Bindings'] {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-made-up-for-this-test',
    ALLOWED_ORIGINS: 'https://nikatru.com',
    NATIVE_AUTH_ACCOUNT_LIMITER: new Limiter(),
    NATIVE_AUTH_EDGE_LIMITER: new Limiter(),
    NATIVE_AUTH_UNATTESTED_LIMITER: new Limiter(),
    NATIVE_AUTH_INSTALL_LIMITER: new Limiter(),
    NATIVE_AUTH_PLAY_VERIFY_LIMITER: playVerify,
    NATIVE_AUTH_ATTEST_KINDS: 'play-integrity,app-attest',
    NATIVE_ATTEST_CHALLENGE_KEY: 'challenge-key-made-up-for-this-test-0123456789',
    PLAY_INTEGRITY_DECRYPTION_KEY: keys.decryptionB64,
    PLAY_INTEGRITY_VERIFICATION_KEY: keys.verificationB64,
    PLAY_INTEGRITY_CERT_DIGESTS: JSON.stringify({ subscriptiontracker: { play: [PLAY_DIGEST], sideload: [SIDELOAD_DIGEST] } }),
    APP_ATTEST_TEAM_ID: TEAM,
    PLATFORM_DB: db,
    ...over,
  } as AppEnv['Bindings'];
}

/** A request as from network `asn` (lib/edge-ceiling.ts keys on request.cf), or the no-cf `edge:-:-` bucket. */
const post = (path: string, text: string, headers: Record<string, string>, bindings: Partial<AppEnv['Bindings']> = {}, asn?: number) => {
  const req = new Request(new URL(path, 'https://platform.test'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Dart/3.9', ...headers },
    body: text,
  });
  if (asn !== undefined) Object.defineProperty(req, 'cf', { value: { colo: 'SIN', asn } });
  return app.request(req, undefined, env(bindings));
};

describe('the route — Play Integrity', () => {
  const text = JSON.stringify({ email: 'a@example.test', password: 'pw' });

  type Payload = ReturnType<typeof verdict>;
  async function signedFor(op: 'token' | 'signup', opts: { body?: string; payload?: (nonce: string) => Payload; signer?: Pick<PlayFixtureKeys, 'aes' | 'signKey'> } = {}) {
    const challenge = await issueChallenge(env(), 'subscriptiontracker', Date.now());
    const path = op === 'token' ? `${BASE}/token?grant_type=password` : `${BASE}/${op}`;
    const target = requestTarget(new URL(path, 'https://x.example'));
    const requestHash = b64url(await sha256(await clientDataFor('subscriptiontracker', op, challenge, target, new TextEncoder().encode(opts.body ?? text))));
    const proof = await playToken((opts.payload ?? verdict)(requestHash), opts.signer ?? keys);
    return { 'X-NK-Attest-Kind': 'play-integrity', 'X-NK-Attest-Challenge': challenge, 'X-NK-Attest-Proof': proof };
  }

  const counter = (scope: string) =>
    Number(db.rows('SELECT calls FROM native_attest_counters WHERE scope = ?', scope)[0]?.calls ?? 0);
  /** The Play path's footprint: no fetch but GoTrue, and no Play counter row of any scope. */
  const noGoogleNoCounters = () => {
    expect(foreign, 'no fetch leaves the Worker on the Play path').toEqual([]);
    expect(db.count('native_attest_counters', "scope = 'play-integrity:decode' OR scope LIKE 'play:%'"), 'no Play counter row').toBe(0);
  };

  it('a genuine token passes, decrypted and verified locally — no fetch but GoTrue, and no counter written', async () => {
    const res = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'));
    expect(res.status).toBe(200);
    expect(gotrueSeen).toBe(1);
    noGoogleNoCounters();
    expect(db.count('native_attest_counters'), 'no daily counter of any scope on the Play path').toBe(0);
    // An attested channel is not held to the unattested channel's session rule.
    expect(await res.json()).toMatchObject({ access_token: 'a' });
  });

  it('a pinned SIDELOAD build (apps.gov.in) passes through the same local path', async () => {
    const sideload = (nonce: string) =>
      verdict(nonce, {
        appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: PKG, certificateSha256Digest: [toB64url(SIDELOAD_DIGEST)] },
      });
    expect((await post(`${BASE}/token?grant_type=password`, text, await signedFor('token', { payload: sideload }))).status).toBe(200);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Red control: the same build is refused while its channel has no pin.
    const unpinned = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token', { payload: sideload }), {
      PLAY_INTEGRITY_CERT_DIGESTS: JSON.stringify({ subscriptiontracker: { play: [PLAY_DIGEST] } }),
    });
    expect(unpinned.status).toBe(401);
    expect(gotrueSeen).toBe(1);
    noGoogleNoCounters();
  });

  it('🔴 a replayed request is 401, and a verdict minted for ANOTHER request\'s nonce does not open this one', async () => {
    const headers = await signedFor('token');
    expect((await post(`${BASE}/token?grant_type=password`, text, headers)).status).toBe(200);
    expect((await post(`${BASE}/token?grant_type=password`, text, headers)).status).toBe(401);
    const forSignup = await signedFor('signup');
    const res = await post(`${BASE}/token?grant_type=password`, text, forSignup);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('attestation_invalid');
    expect(gotrueSeen).toBe(1);
    noGoogleNoCounters();
  });

  it('🔴 a token under another decryption key, signed by another key, or tampered is REFUSED (401 attestation_invalid) — never 5xx', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tamper = async () => {
      const h = await signedFor('token');
      const parts = h['X-NK-Attest-Proof'].split('.');
      const ct = parts[3]!;
      parts[3] = ct.slice(0, 4) + (ct[4] === 'A' ? 'B' : 'A') + ct.slice(5);
      return { ...h, 'X-NK-Attest-Proof': parts.join('.') };
    };
    for (const [why, headers] of [
      ['decrypt', await signedFor('token', { signer: { aes: other.aes, signKey: keys.signKey } })],
      ['signature', await signedFor('token', { signer: { aes: keys.aes, signKey: other.signKey } })],
      ['decrypt', await tamper()],
    ] as const) {
      const res = await post(`${BASE}/token?grant_type=password`, text, headers);
      expect(res.status, why).toBe(401);
      expect(((await res.json()) as { error_code: string }).error_code).toBe('attestation_invalid');
      expect(String(warn.mock.calls.at(-1)?.[0]), 'the log names the step that refused').toContain(`(${why})`);
    }
    expect(gotrueSeen).toBe(0);
    noGoogleNoCounters();
  });

  it('🔴 an app with no pinned signing digest, or either response key absent or malformed, is 503 for this kind — the flag alone opens nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The AES secret where the P-256 SPKI belongs: valid base64, the wrong key entirely.
    const aesWhereSpkiBelongs = String(keys.decryptionB64);
    for (const over of [
      { PLAY_INTEGRITY_CERT_DIGESTS: JSON.stringify({ other: { play: [PLAY_DIGEST] } }) },
      { PLAY_INTEGRITY_DECRYPTION_KEY: undefined },
      { PLAY_INTEGRITY_VERIFICATION_KEY: undefined },
      { PLAY_INTEGRITY_DECRYPTION_KEY: b64std(new Uint8Array(16)) },
      { PLAY_INTEGRITY_VERIFICATION_KEY: aesWhereSpkiBelongs },
    ]) {
      const res = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'), over);
      expect(res.status, Object.keys(over)[0]).toBe(503);
    }
    expect(gotrueSeen).toBe(0);
    noGoogleNoCounters();
  });

  it('🔴 the per-network Play limiter refuses BEFORE any verification', async () => {
    playVerify = new Limiter(1);
    expect((await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'))).status).toBe(200);
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    try {
      const over = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'));
      expect(over.status).toBe(429);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const unbound = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'), { NATIVE_AUTH_PLAY_VERIFY_LIMITER: undefined });
      expect(unbound.status).toBe(503);
      expect(decrypt, 'no token was decrypted past the limiter').not.toHaveBeenCalled();
    } finally {
      decrypt.mockRestore();
    }
    expect(gotrueSeen).toBe(1);
    noGoogleNoCounters();
  });

  it('🔴 O-PLAY-INTEGRITY-LOCAL-VERIFY · the retired daily counters gate nothing: a network at the old share and a day at the old ceiling still pass', async () => {
    // Red control for the removal: before this change these rows answered 429 and 503.
    const day = new Date().toISOString().slice(0, 10);
    db.db.prepare('INSERT INTO native_attest_counters (day, scope, calls) VALUES (?, ?, ?)').run(day, 'play-integrity:decode', 8_000);
    db.db.prepare('INSERT INTO native_attest_counters (day, scope, calls) VALUES (?, ?, ?)').run(day, 'play:edge:SIN:64500', 400);
    expect((await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'), {}, 64500)).status).toBe(200);
    expect((await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'), {}, 64501)).status).toBe(200);
    expect(counter('play-integrity:decode'), 'not bumped').toBe(8_000);
    expect(counter('play:edge:SIN:64500'), 'not bumped').toBe(400);
    expect(counter('play:edge:SIN:64501'), 'never written').toBe(0);
    expect(foreign).toEqual([]);
    // The counter the key kinds still use is per UTC day, and a bump prunes the days before.
    db.db.prepare('INSERT INTO native_attest_counters (day, scope, calls) VALUES (?, ?, ?)').run('2020-01-01', 'install:edge:SIN:64500', 5);
    expect(await bumpDailyCounter(db as unknown as D1Database, 'x', Date.now())).toBe(1);
    expect(db.count('native_attest_counters', 'day = ?', '2020-01-01')).toBe(0);
  });

  it('🔴 SECOND REVIEW 1a · a proof not shaped like an integrity token is 400, and moves NO counter, limiter or crypto', async () => {
    const good = await signedFor('token');
    const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const [, w, iv, ct, tag] = good['X-NK-Attest-Proof'].split('.');
    for (const junk of [
      'x',
      'tok.abc',
      'a.b.c.d.e',
      `${enc({ alg: 'A256KW', enc: 'A256GCM' })}.k..ct.tag`,
      `${enc({ typ: 'JWT' })}.${w}.${iv}.${ct}.${tag}`,
      `${enc({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })}.${w}.${iv}.${ct}.${tag}`,
      `${enc({ alg: 'A256KW', enc: 'A256CBC-HS512' })}.${w}.${iv}.${ct}.${tag}`,
      'A'.repeat(16_000),
    ]) {
      const res = await post(`${BASE}/token?grant_type=password`, text, { ...good, 'X-NK-Attest-Proof': junk });
      expect(res.status, junk.slice(0, 20)).toBe(400);
      expect(((await res.json()) as { error_code: string }).error_code).toBe('attestation_invalid');
    }
    expect(db.count('native_attest_counters')).toBe(0);
    expect(playVerify.calls, 'the per-minute Play budget is not spent either').toBe(0);
    expect(gotrueSeen).toBe(0);
    noGoogleNoCounters();
  });

  it('🔴 SECOND REVIEW nit 8 · a forged challenge spends none of the network\'s Play budget', async () => {
    const good = await signedFor('token');
    const forged = { ...good, 'X-NK-Attest-Challenge': good['X-NK-Attest-Challenge'].replace(/\.[A-Za-z0-9_-]{43}$/, `.${'A'.repeat(43)}`) };
    const res = await post(`${BASE}/token?grant_type=password`, text, forged);
    expect(res.status).toBe(401);
    expect(playVerify.calls).toBe(0);
    expect(db.count('native_attest_counters')).toBe(0);
    noGoogleNoCounters();
  });
});

describe('the route — App Attest ops', () => {
  const text = JSON.stringify({ email: 'a@example.test', password: 'pw' });

  it('a genuine assertion passes and moves the counter; 🔴 a counter that does not move is refused', async () => {
    const a = await attestationFor(await sha256('install'));
    const keyId = b64std(a.keyId);
    db.db
      .prepare('INSERT INTO native_attest_keys (app_id, key_id, kind, public_key, sign_count, created_at, last_used_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run('subscriptiontracker', keyId, 'app-attest', b64url(a.spki), '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z');

    const headersFor = async (counter: number) => {
      const challenge = await issueChallenge(env(), 'subscriptiontracker', Date.now());
      const cd = await clientDataFor('subscriptiontracker', 'token', challenge, `${BASE}/token?grant_type=password`, new TextEncoder().encode(text));
      return {
        'X-NK-Attest-Kind': 'app-attest',
        'X-NK-Attest-Challenge': challenge,
        'X-NK-Attest-Key': keyId,
        'X-NK-Attest-Proof': b64url(await assertionFor(a.leafKey, cd, counter)),
      };
    };
    expect((await post(`${BASE}/token?grant_type=password`, text, await headersFor(1))).status).toBe(200);
    expect(db.rows('SELECT sign_count FROM native_attest_keys WHERE key_id = ?', keyId)[0]!.sign_count).toBe(1);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stale = await post(`${BASE}/token?grant_type=password`, text, await headersFor(1));
    expect(stale.status).toBe(401);
    expect((await post(`${BASE}/token?grant_type=password`, text, await headersFor(2))).status).toBe(200);
    expect(gotrueSeen).toBe(2);
  });

  it('🔴 an App Attest registration on a self-made CA is refused at the route — the route trusts only the Apple root', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The key id the body names is only known once the key exists, and the nonce
    // covers the body — so the attestation is built for a body naming a
    // placeholder, then re-built for the real body with a fresh pair. Either way
    // the chain ends at the test CA, which is the point.
    const probe = await attestationFor(new Uint8Array(32));
    const body = JSON.stringify({ kind: 'app-attest', key_id: b64std(probe.keyId) });
    const challenge = await issueChallenge(env(), 'subscriptiontracker', Date.now());
    const cdh = await sha256(await clientDataFor('subscriptiontracker', 'install', challenge, `${BASE}/attest/install`, new TextEncoder().encode(body)));
    const res = await post(`${BASE}/attest/install`, body, {
      'X-NK-Attest-Kind': 'app-attest',
      'X-NK-Attest-Challenge': challenge,
      'X-NK-Attest-Proof': b64url((await attestationFor(cdh)).attestation),
    });
    expect(res.status).toBe(401);
    expect(db.count('native_attest_keys')).toBe(0);
  });
});
