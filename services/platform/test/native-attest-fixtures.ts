// ─────────────────────────────────────────────────────────────────────────────
// native-attest-fixtures.ts — test-only builders for REAL App Attest objects
// (⏱ 2026-09-30, ADR no.NNN): a DER and CBOR encoder, a test certificate chain
// on WebCrypto, and an attestation / assertion built exactly as a device builds
// them. Apple signs nothing for a test, so the chain ends at a TEST root; the
// verifier's red control is that the same objects fail against the pinned Apple
// root. Shared by native-attest.test.ts and native-auth.test.ts, which drives
// every op through the route with a real `app-attest` assertion.
// ─────────────────────────────────────────────────────────────────────────────
import { concat, sha256 } from '../src/lib/native-attest/bytes';

// ── a minimal DER / CBOR ENCODER, test-only, to build real App Attest objects ──
export const der = (tag: number, ...parts: Uint8Array[]): Uint8Array => {
  const body = concat(...parts);
  const n = body.length;
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return concat(Uint8Array.from([tag, ...len]), body);
};
export const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
export const oid = (h: string) => der(0x06, hexBytes(h));
export const b64std = (b: Uint8Array) => btoa(String.fromCharCode(...b));
/** WebCrypto's r ‖ s → the DER ECDSA-Sig-Value certificates and App Attest carry. */
export const rawToDer = (raw: Uint8Array) => {
  const half = raw.length / 2;
  const int = (v: Uint8Array) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    const t = v.subarray(i);
    return der(0x02, t[0]! & 0x80 ? concat(Uint8Array.of(0), t) : t);
  };
  return seq(int(raw.subarray(0, half)), int(raw.subarray(half)));
};
export const ecPair = (curve: 'P-256' | 'P-384') => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
export const ecSign = async (hash: 'sha256' | 'sha384', data: Uint8Array, key: CryptoKey) =>
  rawToDer(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: hash === 'sha256' ? 'SHA-256' : 'SHA-384' }, key, data)));
export const spkiOf = async (k: CryptoKey) => new Uint8Array((await crypto.subtle.exportKey('spki', k)) as ArrayBuffer);
export const seq = (...p: Uint8Array[]) => der(0x30, ...p);
export const name = (cn: string) => seq(der(0x31, seq(oid('550403'), der(0x0c, new TextEncoder().encode(cn)))));
export const gtime = (ms: number) => der(0x18, new TextEncoder().encode(new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'));
export const ALG = { sha256: seq(oid('2a8648ce3d040302')), sha384: seq(oid('2a8648ce3d040303')) };

export interface TestCert {
  der: Uint8Array;
  key: CryptoKey;
  subject: string;
}
export async function makeCert(opts: {
  subject: string;
  issuer?: TestCert;
  curve: 'P-256' | 'P-384';
  hash: 'sha256' | 'sha384';
  notAfter?: number;
  nonce?: Uint8Array;
}): Promise<TestCert> {
  const pair = await ecPair(opts.curve);
  const spki = await spkiOf(pair.publicKey);
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
  const sig = await ecSign(opts.hash, tbs, signer);
  return { der: seq(tbs, ALG[opts.hash], der(0x03, Uint8Array.of(0), sig)), key: pair.privateKey, subject: opts.subject };
}

export const cbor = (v: unknown): Uint8Array => {
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

export const TEAM = 'ABCDE12345';
export const APP_ID = `${TEAM}.com.nikatru.subscriptiontracker`;
export const AAGUID_PROD = new TextEncoder().encode('appattest\0\0\0\0\0\0\0');
export const AAGUID_DEV = new TextEncoder().encode('appattestdevelop');
export const NOW = Date.UTC(2026, 8, 29);

export async function attestationFor(clientDataHash: Uint8Array, over: { appId?: string; aaguid?: Uint8Array; counter?: number; leafNotAfter?: number; nonceOverride?: Uint8Array } = {}) {
  const root = await makeCert({ subject: 'Test App Attestation Root CA', curve: 'P-384', hash: 'sha384' });
  const intermediate = await makeCert({ subject: 'Test App Attestation CA 1', issuer: root, curve: 'P-384', hash: 'sha384' });
  // The leaf's key must exist before its nonce (which covers authData, which names the key id).
  const leafPair = await ecPair('P-256');
  const spki = await spkiOf(leafPair.publicKey);
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
  const leaf = seq(tbs, ALG.sha256, der(0x03, Uint8Array.of(0), await ecSign('sha256', tbs, intermediate.key)));
  const attestation = cbor({ fmt: 'apple-appattest', attStmt: { x5c: [leaf, intermediate.der], receipt: new Uint8Array(4) }, authData });
  return { attestation, keyId, root: root.der, leafKey: leafPair.privateKey, spki };
}

export async function assertionFor(leafKey: CryptoKey, clientData: string, counter: number, appId = APP_ID) {
  const c = new Uint8Array(4);
  new DataView(c.buffer).setUint32(0, counter);
  const authenticatorData = concat(await sha256(appId), Uint8Array.of(0x40), c);
  const nonce = await sha256(concat(authenticatorData, await sha256(clientData)));
  const signature = await ecSign('sha256', nonce, leafKey);
  return cbor({ signature, authenticatorData });
}

// ── Play Integrity: a classic token as Play's SELF-MANAGED response encryption mints it ──
// (⏱ 2026-10-03, O-PLAY-INTEGRITY-LOCAL-VERIFY). A compact JWE (A256KW + A256GCM,
// RFC 7516) around a compact JWS (ES256, RFC 7515) around the verdict JSON — built
// with WebCrypto from keys generated HERE, at test time. No real key is committed.
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s: string) => new TextEncoder().encode(s);

export interface PlayFixtureKeys {
  /** The AES-256 key-encryption key, raw. */
  aes: Uint8Array;
  /** The ES256 signing key (Google's half; the Worker holds only its SPKI). */
  signKey: CryptoKey;
  /** The two Worker secrets, exactly as Play Console shows them: standard base64. */
  decryptionB64: string;
  verificationB64: string;
}

export async function playFixtureKeys(): Promise<PlayFixtureKeys> {
  const aes = crypto.getRandomValues(new Uint8Array(32));
  const pair = (await ecPair('P-256')) as CryptoKeyPair;
  return { aes, signKey: pair.privateKey, decryptionB64: b64std(aes), verificationB64: b64std(await spkiOf(pair.publicKey)) };
}

/** Signs `payload` as a compact ES256 JWS (raw r ‖ s, as WebCrypto emits it). */
export async function playJws(payload: unknown, signKey: CryptoKey, header: Record<string, unknown> = { alg: 'ES256' }): Promise<string> {
  const input = `${b64u(utf8(JSON.stringify(header)))}.${b64u(utf8(JSON.stringify(payload)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, utf8(input)));
  return `${input}.${b64u(sig)}`;
}

/** Encrypts `plaintext` as a compact JWE: a fresh CEK wrapped by `aes` (A256KW), AES-256-GCM with the protected header as AAD. */
export async function playJwe(plaintext: string, aes: Uint8Array, header: Record<string, unknown> = { alg: 'A256KW', enc: 'A256GCM' }): Promise<string> {
  const h = b64u(utf8(JSON.stringify(header)));
  const kek = await crypto.subtle.importKey('raw', aes, { name: 'AES-KW' }, false, ['wrapKey']);
  const cek = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])) as CryptoKey;
  const wrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', cek, kek, { name: 'AES-KW' }));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(h), tagLength: 128 }, cek, utf8(plaintext)));
  return [h, b64u(wrapped), b64u(iv), b64u(sealed.subarray(0, sealed.length - 16)), b64u(sealed.subarray(sealed.length - 16))].join('.');
}

/** A classic integrity token for `payload`: signed with `keys.signKey`, encrypted under `keys.aes`. */
export async function playToken(payload: unknown, keys: Pick<PlayFixtureKeys, 'aes' | 'signKey'>): Promise<string> {
  return playJwe(await playJws(payload, keys.signKey), keys.aes);
}
