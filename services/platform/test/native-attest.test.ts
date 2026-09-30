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
//     each field that is wrong; the Google calls are made with a correctly
//     signed service-account JWT; a Google fault is 503, never a pass; and at
//     the ROUTE a verdict answers only the request whose nonce it carries.
// Nothing here reaches a network: Google and GoTrue are fakes behind `fetch`.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { app } from '../src/index';
import type { AppEnv, RateLimiterBinding } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';
import {
  bumpDailyCounter,
  clientDataFor,
  issueChallenge,
  PLAY_INTEGRITY_DAILY_CEILING,
  PLAY_INTEGRITY_DAILY_PER_NETWORK,
  requestTarget,
} from '../src/lib/native-attest';
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
} from './native-attest-fixtures';
import { gradeVerdict, resetPlayIntegrityTokenCache, verifyPlayIntegrity, type CertPins } from '../src/lib/native-attest/play-integrity';

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

// ── the ROUTE, for App Attest and Play Integrity ──────────────────────────────
class Limiter implements RateLimiterBinding {
  calls = 0;
  constructor(private readonly cap = Number.POSITIVE_INFINITY) {}
  async limit(): Promise<{ success: boolean }> {
    return { success: ++this.calls <= this.cap };
  }
}
let playVerify = new Limiter();

const SUPABASE_URL = 'https://native-attest-test.gotrue.example';
const BASE = '/v1/auth/native/subscriptiontracker';
let rsa: CryptoKeyPair;
let SERVICE_ACCOUNT: string;

let db: RealDb;
let google: { tokens: string[]; decodes: Array<{ url: string; auth: string | null; token: string }>; status: number };
let gotrueSeen: number;

beforeAll(async () => {
  rsa = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', rsa.privateKey)) as ArrayBuffer);
  SERVICE_ACCOUNT = JSON.stringify({
    client_email: 'play-integrity@test-project.iam.gserviceaccount.com',
    private_key: ['-----BEGIN PRIVATE KEY-----', ...b64std(pkcs8).match(/.{1,64}/g)!, '-----END PRIVATE KEY-----', ''].join('\n'),
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    // Routed by ORIGIN, never by string prefix (CodeQL js/incomplete-url-substring-sanitization).
    const origin = new URL(url).origin;
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(String(init.body)).get('assertion')!;
      google.tokens.push(assertion);
      return new Response(JSON.stringify({ access_token: 'google-access-token', expires_in: 3600 }), { status: 200 });
    }
    if (origin === 'https://playintegrity.googleapis.com') {
      const token = (JSON.parse(String(init.body)) as { integrity_token: string }).integrity_token;
      google.decodes.push({ url, auth: new Headers(init.headers).get('authorization'), token });
      if (google.status !== 200) return new Response('{}', { status: google.status });
      // The fake Google "decrypts" a JWE-shaped token whose second segment is the nonce into a genuine verdict for it.
      return new Response(JSON.stringify({ tokenPayloadExternal: verdict(token.split('.')[1]!) }), { status: 200 });
    }
    if (origin === new URL(SUPABASE_URL).origin) {
      gotrueSeen++;
      return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 'u', email_confirmed_at: null } }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  db = realPlatformDb();
  google = { tokens: [], decodes: [], status: 200 };
  gotrueSeen = 0;
  playVerify = new Limiter();
  resetPlayIntegrityTokenCache();
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
    PLAY_INTEGRITY_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
    PLAY_INTEGRITY_CERT_DIGESTS: JSON.stringify({ subscriptiontracker: { play: [PLAY_DIGEST] } }),
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

/** A classic integrity token's SHAPE — a compact JWE — carrying `nonce` where the fake Google reads it. */
const JWE_HEADER = b64url(new TextEncoder().encode('{"alg":"A256KW","enc":"A256GCM"}'));
const jwe = (nonce: string) => `${JWE_HEADER}.${nonce}.aXYtaXYtaXYtaXY.Y2lwaGVydGV4dA.dGFndGFndGFndGFn`;

describe('the route — Play Integrity', () => {
  const text = JSON.stringify({ email: 'a@example.test', password: 'pw' });

  async function signedFor(op: 'token' | 'signup', body = text) {
    const challenge = await issueChallenge(env(), 'subscriptiontracker', Date.now());
    const path = op === 'token' ? `${BASE}/token?grant_type=password` : `${BASE}/${op}`;
    const target = requestTarget(new URL(path, 'https://x.example'));
    const requestHash = b64url(await sha256(await clientDataFor('subscriptiontracker', op, challenge, target, new TextEncoder().encode(body))));
    return { 'X-NK-Attest-Kind': 'play-integrity', 'X-NK-Attest-Challenge': challenge, 'X-NK-Attest-Proof': jwe(requestHash) };
  }

  it('a genuine verdict passes, decoded at Google with a correctly signed service-account JWT', async () => {
    const res = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'));
    expect(res.status).toBe(200);
    expect(gotrueSeen).toBe(1);
    expect(google.decodes[0]!.url).toBe(`https://playintegrity.googleapis.com/v1/${PKG}:decodeIntegrityToken`);
    expect(google.decodes[0]!.auth).toBe('Bearer google-access-token');
    const [h, p, s] = google.tokens[0]!.split('.');
    const utf8 = (x: string) => new TextDecoder().decode(fromB64url(x)!);
    expect(JSON.parse(utf8(h!))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(utf8(p!))).toMatchObject({
      iss: 'play-integrity@test-project.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/playintegrity',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', rsa.publicKey, fromB64url(s!)!, new TextEncoder().encode(`${h}.${p}`))).toBe(true);
    // An attested channel is not held to the unattested channel's session rule.
    expect(await res.json()).toMatchObject({ access_token: 'a' });
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
  });

  it('🔴 a Google fault is 503, never a pass; a token Google rejects is 401', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    google.status = 500;
    expect((await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'))).status).toBe(503);
    google.status = 400;
    expect((await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'))).status).toBe(401);
    expect(gotrueSeen).toBe(0);
  });

  it('🔴 an app with no pinned signing digest is 503 for this kind — the flag alone opens nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'), { PLAY_INTEGRITY_CERT_DIGESTS: JSON.stringify({ other: { play: [PLAY_DIGEST] } }) });
    expect(res.status).toBe(503);
    expect(google.decodes).toHaveLength(0);
  });

  it('🔴 the per-network Play limiter refuses BEFORE Google is asked (review of #1070)', async () => {
    playVerify = new Limiter(1);
    expect((await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'))).status).toBe(200);
    const over = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'));
    expect(over.status).toBe(429);
    expect(google.decodes).toHaveLength(1);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const unbound = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'), { NATIVE_AUTH_PLAY_VERIFY_LIMITER: undefined });
    expect(unbound.status).toBe(503);
    expect(google.decodes).toHaveLength(1);
  });

  it('🔴 the daily global ceiling below Google\'s quota is 503 without a Google call once reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const day = new Date().toISOString().slice(0, 10);
    db.db.prepare('INSERT INTO native_attest_counters (day, scope, calls) VALUES (?, ?, ?)').run(day, 'play-integrity:decode', PLAY_INTEGRITY_DAILY_CEILING);
    const res = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'));
    expect(res.status).toBe(503);
    expect(google.decodes).toHaveLength(0);
    expect(PLAY_INTEGRITY_DAILY_CEILING).toBeLessThan(10_000);
    // The counter is per UTC day, and a bump prunes the days before.
    db.db.prepare('INSERT INTO native_attest_counters (day, scope, calls) VALUES (?, ?, ?)').run('2020-01-01', 'play-integrity:decode', 5);
    expect(await bumpDailyCounter(db as unknown as D1Database, 'x', Date.now())).toBe(1);
    expect(db.count('native_attest_counters', 'day = ?', '2020-01-01')).toBe(0);
  });

  const counter = (scope: string) =>
    Number(db.rows('SELECT calls FROM native_attest_counters WHERE scope = ?', scope)[0]?.calls ?? 0);

  it('🔴 SECOND REVIEW 1a · a proof not shaped like an integrity token is 400, and moves NO counter, limiter or Google call', async () => {
    const good = await signedFor('token');
    for (const junk of ['x', 'tok.abc', 'a.b.c.d.e', `${JWE_HEADER}.k..ct.tag`,`${b64url(new TextEncoder().encode('{}'))}.k.iv.ct.tag`, 'A'.repeat(16_000)]) {
      const res = await post(`${BASE}/token?grant_type=password`, text, { ...good, 'X-NK-Attest-Proof': junk });
      expect(res.status, junk.slice(0, 20)).toBe(400);
      expect(((await res.json()) as { error_code: string }).error_code).toBe('attestation_invalid');
    }
    expect(counter('play-integrity:decode')).toBe(0);
    expect(db.count('native_attest_counters')).toBe(0);
    expect(playVerify.calls, 'the per-minute Play budget is not spent either').toBe(0);
    expect(google.decodes).toHaveLength(0);
    expect(gotrueSeen).toBe(0);
  });

  it('🔴 SECOND REVIEW 1b · one network stops at its daily share (5% of the ceiling) while another network still passes', async () => {
    expect(PLAY_INTEGRITY_DAILY_PER_NETWORK).toBe(PLAY_INTEGRITY_DAILY_CEILING / 20);
    const day = new Date().toISOString().slice(0, 10);
    db.db.prepare('INSERT INTO native_attest_counters (day, scope, calls) VALUES (?, ?, ?)').run(day, 'play:edge:SIN:64500', PLAY_INTEGRITY_DAILY_PER_NETWORK);
    const capped = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'), {}, 64500);
    expect(capped.status).toBe(429);
    expect(Number(capped.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(google.decodes, 'the capped network reached no Google call').toHaveLength(0);
    expect(counter('play-integrity:decode'), 'nor the global ceiling').toBe(0);
    const other = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'), {}, 64501);
    expect(other.status).toBe(200);
    expect(counter('play:edge:SIN:64501')).toBe(1);
    expect(counter('play-integrity:decode')).toBe(1);
  });

  it('🔴 SECOND REVIEW nit 8 · a forged challenge spends none of the network\'s Play budget', async () => {
    const good = await signedFor('token');
    const forged = { ...good, 'X-NK-Attest-Challenge': good['X-NK-Attest-Challenge'].replace(/\.[A-Za-z0-9_-]{43}$/, `.${'A'.repeat(43)}`) };
    const res = await post(`${BASE}/token?grant_type=password`, text, forged);
    expect(res.status).toBe(401);
    expect(playVerify.calls).toBe(0);
    expect(db.count('native_attest_counters')).toBe(0);
  });

  it('a direct verify call reuses one OAuth token across decodes', async () => {
    const sa = { client_email: 'play-integrity@test-project.iam.gserviceaccount.com', private_key: JSON.parse(SERVICE_ACCOUNT).private_key as string };
    const H = 'vhEcb1KdwBN_Qi1H40RTtnWH4fDw60TeZxBYTwvGb8M';
    expect((await verifyPlayIntegrity(jwe(H), PKG, H, sa, PINS, Date.now())).ok).toBe(true);
    expect((await verifyPlayIntegrity(jwe(H), PKG, H, sa, PINS, Date.now())).ok).toBe(true);
    expect(google.tokens).toHaveLength(1);
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
