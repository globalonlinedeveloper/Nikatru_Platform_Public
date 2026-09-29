// ─────────────────────────────────────────────────────────────────────────────
// native-attest.test.ts — the three proofs behind the native sign-in route
// (⏱ 2026-09-29, ADR no.NNN; src/lib/native-attest/).
//
// WHAT IS BEING PROVEN, each case the shape of a way this could be wrong:
//   · THE BINDING matches the wire protocol's published test vector, byte for
//     byte — the Dart client (packages/core native_attest.dart) asserts the same
//     literals, so the two runtimes cannot drift apart silently;
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
import { generateKeyPairSync, sign as nodeSign, createVerify, type KeyObject } from 'node:crypto';
import { app } from '../src/index';
import type { AppEnv, RateLimiterBinding } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';
import { clientDataFor, issueChallenge } from '../src/lib/native-attest';
import { b64url, concat, fromB64url, sha256 } from '../src/lib/native-attest/bytes';
import { APPLE_APP_ATTEST_ROOT_PEM, appleRootDer, verifyAssertion, verifyAttestation } from '../src/lib/native-attest/app-attest';
import { issuedBy, parseCertificate, pemToDer } from '../src/lib/native-attest/x509';
import { gradeVerdict, resetPlayIntegrityTokenCache, verifyPlayIntegrity, type CertPins } from '../src/lib/native-attest/play-integrity';

// ── the wire protocol's test vector (scratch: protocol v1, "Test vector") ──────
describe('the binding — the published vector, byte for byte', () => {
  const challenge = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  const body = new TextEncoder().encode('{"email":"a@example.test","password":"pw"}');

  it('clientData, bodyHash and requestHash are the vector\'s', async () => {
    const cd = await clientDataFor('subscriptiontracker', 'token', challenge, body);
    expect(cd).toBe(`nk-native-auth/v1\nsubscriptiontracker\ntoken\n${challenge}\n6iU0klSWpvzudfyl590CwvA54eDW4neVBb9Nc2Uk35U`);
    expect(b64url(await sha256(cd))).toBe('vhEcb1KdwBN_Qi1H40RTtnWH4fDw60TeZxBYTwvGb8M');
    // Red control: one byte of body changes the binding.
    const other = await clientDataFor('subscriptiontracker', 'token', challenge, new TextEncoder().encode('{"email":"a@example.test","password":"pX"}'));
    expect(other).not.toBe(cd);
  });

  it('the Ed25519 vector: seed 32×0x07 gives the vector\'s key id and signature', async () => {
    const pkcs8 = concat(Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]), new Uint8Array(32).fill(7));
    const priv = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
    const cd = await clientDataFor('subscriptiontracker', 'token', challenge, body);
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, priv, new TextEncoder().encode(cd)));
    expect(b64url(sig)).toBe('sXemf003ur6yGpxrN1ZBAnOmflYWJdjMcLVGP9dNx7KQO-olH_EwF7FvyROu2eX9iO5CELDKf58HkCKRdDMUAQ');
    const pub = fromB64url('6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw')!;
    expect(b64url(await sha256(pub))).toBe('_oEsEvOrTOasXbaaw1L5BssbEe9D-zPiUu9_9VImOIk');
  });
});

// ── a minimal DER / CBOR ENCODER, test-only, to build real App Attest objects ──
const der = (tag: number, ...parts: Uint8Array[]): Uint8Array => {
  const body = concat(...parts);
  const n = body.length;
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return concat(Uint8Array.from([tag, ...len]), body);
};
const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const oid = (h: string) => der(0x06, hexBytes(h));
const seq = (...p: Uint8Array[]) => der(0x30, ...p);
const name = (cn: string) => seq(der(0x31, seq(oid('550403'), der(0x0c, new TextEncoder().encode(cn)))));
const gtime = (ms: number) => der(0x18, new TextEncoder().encode(new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'));
const ALG = { sha256: seq(oid('2a8648ce3d040302')), sha384: seq(oid('2a8648ce3d040303')) };

interface TestCert {
  der: Uint8Array;
  key: KeyObject;
  subject: string;
}
function makeCert(opts: {
  subject: string;
  issuer?: TestCert;
  curve: 'P-256' | 'P-384';
  hash: 'sha256' | 'sha384';
  notAfter?: number;
  nonce?: Uint8Array;
}): TestCert & { publicKey: KeyObject } {
  const pair = generateKeyPairSync('ec', { namedCurve: opts.curve === 'P-256' ? 'prime256v1' : 'secp384r1' });
  const spki = new Uint8Array(pair.publicKey.export({ type: 'spki', format: 'der' }));
  const exts = opts.nonce
    ? [der(0xa3, seq(seq(oid('2a864886f763640802'), der(0x04, seq(der(0xa1, der(0x04, opts.nonce)))))))]
    : [];
  const tbs = seq(
    der(0xa0, der(0x02, Uint8Array.of(2))),
    der(0x02, Uint8Array.of(1)),
    ALG[opts.hash],
    name(opts.issuer?.subject ?? opts.subject),
    seq(gtime(Date.UTC(2024, 0, 1)), gtime(opts.notAfter ?? Date.UTC(2040, 0, 1))),
    name(opts.subject),
    spki,
    ...exts,
  );
  const signer = opts.issuer?.key ?? pair.privateKey;
  const sig = new Uint8Array(nodeSign(opts.hash, tbs, { key: signer, dsaEncoding: 'der' }));
  return { der: seq(tbs, ALG[opts.hash], der(0x03, Uint8Array.of(0), sig)), key: pair.privateKey, publicKey: pair.publicKey, subject: opts.subject };
}

const cbor = (v: unknown): Uint8Array => {
  const head = (major: number, n: number) =>
    n < 24 ? Uint8Array.of((major << 5) | n) : n < 0x100 ? Uint8Array.of((major << 5) | 24, n) : Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    return concat(head(3, b.length), b);
  }
  if (Array.isArray(v)) return concat(head(4, v.length), ...v.map(cbor));
  const entries = Object.entries(v as Record<string, unknown>);
  return concat(head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)]));
};

const TEAM = 'ABCDE12345';
const APP_ID = `${TEAM}.com.nikatru.subscriptiontracker`;
const AAGUID_PROD = new TextEncoder().encode('appattest\0\0\0\0\0\0\0');
const AAGUID_DEV = new TextEncoder().encode('appattestdevelop');
const NOW = Date.UTC(2026, 8, 29);

async function attestationFor(clientDataHash: Uint8Array, over: { appId?: string; aaguid?: Uint8Array; counter?: number; leafNotAfter?: number; nonceOverride?: Uint8Array } = {}) {
  const root = makeCert({ subject: 'Test App Attestation Root CA', curve: 'P-384', hash: 'sha384' });
  const intermediate = makeCert({ subject: 'Test App Attestation CA 1', issuer: root, curve: 'P-384', hash: 'sha384' });
  // The leaf's key must exist before its nonce (which covers authData, which names the key id).
  const leafPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = new Uint8Array(leafPair.publicKey.export({ type: 'spki', format: 'der' }));
  const point = spki.subarray(spki.length - 65);
  const keyId = await sha256(point);
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, over.counter ?? 0);
  const authData = concat(
    await sha256(over.appId ?? APP_ID),
    Uint8Array.of(0x40),
    counter,
    over.aaguid ?? AAGUID_PROD,
    Uint8Array.of(0, 32),
    keyId,
    cbor({ '1': 'cose-key-not-read' }),
  );
  const nonce = over.nonceOverride ?? (await sha256(concat(authData, clientDataHash)));
  // Build the leaf around the pre-made key pair.
  const exts = der(0xa3, seq(seq(oid('2a864886f763640802'), der(0x04, seq(der(0xa1, der(0x04, nonce)))))));
  const tbs = seq(
    der(0xa0, der(0x02, Uint8Array.of(2))),
    der(0x02, Uint8Array.of(7)),
    ALG.sha256,
    name(intermediate.subject),
    seq(gtime(Date.UTC(2024, 0, 1)), gtime(over.leafNotAfter ?? Date.UTC(2040, 0, 1))),
    name('leaf'),
    spki,
    exts,
  );
  const leaf = seq(tbs, ALG.sha256, der(0x03, Uint8Array.of(0), new Uint8Array(nodeSign('sha256', tbs, { key: intermediate.key, dsaEncoding: 'der' }))));
  const attestation = cbor({ fmt: 'apple-appattest', attStmt: { x5c: [leaf, intermediate.der], receipt: new Uint8Array(4) }, authData });
  return { attestation, keyId, root: root.der, leafKey: leafPair.privateKey, spki };
}

async function assertionFor(leafKey: KeyObject, clientData: string, counter: number, appId = APP_ID) {
  const c = new Uint8Array(4);
  new DataView(c.buffer).setUint32(0, counter);
  const authenticatorData = concat(await sha256(appId), Uint8Array.of(0x40), c);
  const nonce = await sha256(concat(authenticatorData, await sha256(clientData)));
  const signature = new Uint8Array(nodeSign('sha256', nonce, { key: leafKey, dsaEncoding: 'der' }));
  return cbor({ signature, authenticatorData });
}

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
  async limit(): Promise<{ success: boolean }> {
    return { success: true };
  }
}

const SUPABASE_URL = 'https://native-attest-test.gotrue.example';
const BASE = '/v1/auth/native/subscriptiontracker';
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({
  client_email: 'play-integrity@test-project.iam.gserviceaccount.com',
  private_key: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});

let db: RealDb;
let google: { tokens: string[]; decodes: Array<{ url: string; auth: string | null; token: string }>; status: number };
let gotrueSeen: number;

beforeAll(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(String(init.body)).get('assertion')!;
      google.tokens.push(assertion);
      return new Response(JSON.stringify({ access_token: 'google-access-token', expires_in: 3600 }), { status: 200 });
    }
    if (url.startsWith('https://playintegrity.googleapis.com/')) {
      const token = (JSON.parse(String(init.body)) as { integrity_token: string }).integrity_token;
      google.decodes.push({ url, auth: new Headers(init.headers).get('authorization'), token });
      if (google.status !== 200) return new Response('{}', { status: google.status });
      // The fake Google "decrypts" a token of the form `tok.<nonce>` into a genuine verdict for that nonce.
      return new Response(JSON.stringify({ tokenPayloadExternal: verdict(token.split('.')[1]!) }), { status: 200 });
    }
    if (url.startsWith(SUPABASE_URL)) {
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
    NATIVE_AUTH_ATTEST_KINDS: 'play-integrity,app-attest,install-key',
    PLAY_INTEGRITY_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
    PLAY_INTEGRITY_CERT_DIGESTS: JSON.stringify({ subscriptiontracker: { play: [PLAY_DIGEST] } }),
    APP_ATTEST_TEAM_ID: TEAM,
    PLATFORM_DB: db,
    ...over,
  } as AppEnv['Bindings'];
}

const post = (path: string, text: string, headers: Record<string, string>, bindings: Partial<AppEnv['Bindings']> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Dart/3.9', ...headers }, body: text }, env(bindings));

describe('the route — Play Integrity', () => {
  const text = JSON.stringify({ email: 'a@example.test', password: 'pw' });

  async function signedFor(op: 'token' | 'signup', body = text) {
    const challenge = await issueChallenge(db as unknown as D1Database, 'subscriptiontracker', Date.now());
    const requestHash = b64url(await sha256(await clientDataFor('subscriptiontracker', op, challenge, new TextEncoder().encode(body))));
    return { 'X-NK-Attest-Kind': 'play-integrity', 'X-NK-Attest-Challenge': challenge, 'X-NK-Attest-Proof': `tok.${requestHash}` };
  }

  it('a genuine verdict passes, decoded at Google with a correctly signed service-account JWT', async () => {
    const res = await post(`${BASE}/token?grant_type=password`, text, await signedFor('token'));
    expect(res.status).toBe(200);
    expect(gotrueSeen).toBe(1);
    expect(google.decodes[0]!.url).toBe(`https://playintegrity.googleapis.com/v1/${PKG}:decodeIntegrityToken`);
    expect(google.decodes[0]!.auth).toBe('Bearer google-access-token');
    const [h, p, s] = google.tokens[0]!.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toMatchObject({
      iss: 'play-integrity@test-project.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/playintegrity',
      aud: 'https://oauth2.googleapis.com/token',
    });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${h}.${p}`);
    expect(verifier.verify(rsa.publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
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

  it('a direct verify call reuses one OAuth token across decodes', async () => {
    const sa = { client_email: 'play-integrity@test-project.iam.gserviceaccount.com', private_key: JSON.parse(SERVICE_ACCOUNT).private_key as string };
    const H = 'vhEcb1KdwBN_Qi1H40RTtnWH4fDw60TeZxBYTwvGb8M';
    expect((await verifyPlayIntegrity(`tok.${H}`, PKG, H, sa, PINS, Date.now())).ok).toBe(true);
    expect((await verifyPlayIntegrity(`tok.${H}`, PKG, H, sa, PINS, Date.now())).ok).toBe(true);
    expect(google.tokens).toHaveLength(1);
  });
});

describe('the route — App Attest ops', () => {
  const text = JSON.stringify({ email: 'a@example.test', password: 'pw' });

  it('a genuine assertion passes and moves the counter; 🔴 a counter that does not move is refused', async () => {
    const a = await attestationFor(await sha256('install'));
    const keyId = Buffer.from(a.keyId).toString('base64');
    db.db
      .prepare('INSERT INTO native_attest_keys (app_id, key_id, kind, public_key, sign_count, created_at, last_used_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run('subscriptiontracker', keyId, 'app-attest', b64url(a.spki), '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z');

    const headersFor = async (counter: number) => {
      const challenge = await issueChallenge(db as unknown as D1Database, 'subscriptiontracker', Date.now());
      const cd = await clientDataFor('subscriptiontracker', 'token', challenge, new TextEncoder().encode(text));
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
    const body = JSON.stringify({ kind: 'app-attest', key_id: Buffer.from(probe.keyId).toString('base64') });
    const challenge = await issueChallenge(db as unknown as D1Database, 'subscriptiontracker', Date.now());
    const cdh = await sha256(await clientDataFor('subscriptiontracker', 'install', challenge, new TextEncoder().encode(body)));
    const res = await post(`${BASE}/attest/install`, body, {
      'X-NK-Attest-Kind': 'app-attest',
      'X-NK-Attest-Challenge': challenge,
      'X-NK-Attest-Proof': b64url((await attestationFor(cdh)).attestation),
    });
    expect(res.status).toBe(401);
    expect(db.count('native_attest_keys')).toBe(0);
  });
});
