// ─────────────────────────────────────────────────────────────────────────────
// play-integrity.ts — Google Play Integrity, server side (⏱ 2026-09-29, ADR no.NNN;
// ⏱ 2026-10-03 O-PLAY-INTEGRITY-LOCAL-VERIFY: decoded LOCALLY, no Google call).
//
// The app sends a CLASSIC integrity token whose nonce is the protocol's
// requestHash (binding.ts). With Play Console's SELF-MANAGED response
// encryption the token is a compact JWE (RFC 7516, alg A256KW, enc A256GCM)
// whose plaintext is a compact JWS (RFC 7515, alg ES256) over the verdict JSON.
// This Worker decrypts it with PLAY_INTEGRITY_DECRYPTION_KEY, verifies Google's
// signature with PLAY_INTEGRITY_VERIFICATION_KEY — WebCrypto only, no fetch, no
// npm package — and then grades the verdict itself:
//
//   · requestDetails.requestPackageName and appIntegrity.packageName are
//     `com.nikatru.<app>`;
//   · requestDetails.nonce is the requestHash — the verdict answers THIS call,
//     whose single-use challenge the route has already consumed;
//   · requestDetails.timestampMillis is within MAX_SKEW_MS of now;
//   · appIntegrity.certificateSha256Digest contains a PINNED signing digest;
//   · appIntegrity.appRecognitionVerdict is PLAY_RECOGNIZED — except for a
//     digest pinned as a SIDELOAD channel's (apps.gov.in: a self-signed .apk
//     Google Play never saw), where UNRECOGNIZED_VERSION is the honest verdict
//     and the pinned digest is what identifies the build;
//   · deviceIntegrity.deviceRecognitionVerdict includes MEETS_DEVICE_INTEGRITY.
//
// WHY LOCAL (O-PLAY-INTEGRITY-LOCAL-VERIFY): decoding at Google spent a daily
// Cloud quota BEFORE any proof was verified, so one script could exhaust it and
// switch Android sign-in off for everyone. A local decode spends nothing shared:
// a token that does not decrypt or verify is refused, and costs only CPU.
//
// 🔴 NOTHING HERE IS ON UNTIL THE OWNER'S KEYS EXIST. Both response keys and the
// Play app-signing digest are owner-provisioned; without any of them the route
// answers 503 for this kind — it never degrades to "no check".
// ─────────────────────────────────────────────────────────────────────────────
import { b64url, equalBytes, fromB64, fromB64url } from './bytes';

/** How far a verdict's own timestamp may sit from now. @ceiling none — a freshness bound on an input. */
export const PLAY_INTEGRITY_MAX_SKEW_MS = 5 * 60_000;
/** The pinned signing digests for one app: Play-signed, and sideload channels'. */
export interface CertPins {
  play: string[];
  sideload: string[];
}

/** `AB:CD:…` (keytool / Play Console) or base64url (the verdict's own form) → base64url. */
export function normaliseDigest(d: string): string | null {
  const t = d.trim();
  if (/^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(t)) {
    return b64url(Uint8Array.from(t.split(':').map((h) => parseInt(h, 16))));
  }
  const raw = fromB64url(t.replace(/\+/g, '-').replace(/\//g, '_'));
  return raw && raw.length === 32 ? b64url(raw) : null;
}

/** `{ "<app>": { "play": [digest…], "sideload": [digest…] } }` → the app's pins, or null when it has none. */
export function pinsFor(json: string | undefined, app: string): CertPins | null {
  if (!json) return null;
  try {
    const all = JSON.parse(json) as Record<string, { play?: unknown; sideload?: unknown }>;
    const row = all[app];
    if (!row) return null;
    const list = (v: unknown) => (Array.isArray(v) ? v.map((d) => (typeof d === 'string' ? normaliseDigest(d) : null)).filter((d): d is string => d !== null) : []);
    const pins = { play: list(row.play), sideload: list(row.sideload) };
    return pins.play.length + pins.sideload.length > 0 ? pins : null;
  } catch {
    return null;
  }
}

/** The two self-managed response keys, as Play Console issues them. */
export interface PlayKeys {
  /** 32 raw AES-256 bytes: the key-encryption key (A256KW). */
  decryption: Uint8Array;
  /** An EC P-256 SubjectPublicKeyInfo, DER: Google's verdict-signing key (ES256). */
  verification: Uint8Array;
}

/** The DER every P-256 SubjectPublicKeyInfo starts with (id-ecPublicKey, prime256v1, BIT STRING of 66). */
const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
  0x42, 0x00, 0x04,
]);

/**
 * The two Worker secrets (standard base64, as Play Console shows them) → the
 * keys, or null when either is absent or not the shape it must be: the
 * decryption key exactly 32 bytes, the verification key an uncompressed P-256
 * SPKI. Synchronous and pure, so `configured()` can ask it per request.
 */
export function parsePlayKeys(decryption: string | undefined, verification: string | undefined): PlayKeys | null {
  const d = decryption ? fromB64(decryption.replace(/\s+/g, '')) : null;
  const v = verification ? fromB64(verification.replace(/\s+/g, '')) : null;
  if (!d || d.length !== 32 || !v || v.length !== P256_SPKI_PREFIX.length + 64) return null;
  return equalBytes(v.subarray(0, P256_SPKI_PREFIX.length), P256_SPKI_PREFIX) ? { decryption: d, verification: v } : null;
}

// Imported keys, memoised per secret value (an isolate serves many requests).
let imported: { id: string; kek: Promise<CryptoKey>; spki: Promise<CryptoKey> } | null = null;

/** Test seam: forget the imported keys (a later test's fixture keys must not meet an earlier test's). */
export function resetPlayIntegrityKeyCache(): void {
  imported = null;
}

function importedKeys(keys: PlayKeys): { kek: Promise<CryptoKey>; spki: Promise<CryptoKey> } {
  const id = `${b64url(keys.decryption)}.${b64url(keys.verification)}`;
  if (imported?.id !== id) {
    imported = {
      id,
      kek: crypto.subtle.importKey('raw', keys.decryption, { name: 'AES-KW' }, false, ['unwrapKey']),
      spki: crypto.subtle.importKey('spki', keys.verification, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
    };
  }
  return imported;
}

export type PlayVerdict = { ok: true; channel: 'play' | 'sideload' } | { ok: false; why: string };

interface Payload {
  requestDetails?: { requestPackageName?: unknown; nonce?: unknown; timestampMillis?: unknown };
  appIntegrity?: { appRecognitionVerdict?: unknown; packageName?: unknown; certificateSha256Digest?: unknown };
  deviceIntegrity?: { deviceRecognitionVerdict?: unknown };
}

/** Grades a decoded verdict. Pure — the tests drive it directly. */
export function gradeVerdict(p: Payload, pkg: string, requestHash: string, pins: CertPins, now: number): PlayVerdict {
  const rd = p.requestDetails ?? {};
  const ai = p.appIntegrity ?? {};
  if (rd.requestPackageName !== pkg || ai.packageName !== pkg) return { ok: false, why: 'package' };
  const nonce = typeof rd.nonce === 'string' ? rd.nonce.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
  if (nonce !== requestHash) return { ok: false, why: 'nonce' };
  const ts = Number(rd.timestampMillis);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > PLAY_INTEGRITY_MAX_SKEW_MS) return { ok: false, why: 'timestamp' };
  const digests = Array.isArray(ai.certificateSha256Digest)
    ? ai.certificateSha256Digest.map((d) => (typeof d === 'string' ? normaliseDigest(d) : null))
    : [];
  const verdict = ai.appRecognitionVerdict;
  let channel: 'play' | 'sideload' | null = null;
  if (verdict === 'PLAY_RECOGNIZED' && digests.some((d) => d !== null && pins.play.includes(d))) channel = 'play';
  else if (verdict === 'UNRECOGNIZED_VERSION' && digests.some((d) => d !== null && pins.sideload.includes(d))) channel = 'sideload';
  if (!channel) return { ok: false, why: 'app' };
  const device = p.deviceIntegrity?.deviceRecognitionVerdict;
  if (!Array.isArray(device) || !device.includes('MEETS_DEVICE_INTEGRITY')) return { ok: false, why: 'device' };
  return { ok: true, channel };
}

/** UTF-8 that THROWS on a malformed byte (a lenient decode would turn junk into U+FFFD and parse on). */
const strictUtf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

/** The protected header every self-managed classic token carries. */
const JWE_ALG = 'A256KW';
const JWE_ENC = 'A256GCM';

/** A compact JWE's five segments, decoded; null when it is not Play's shape. */
interface Jwe {
  header: string;
  wrappedKey: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

function decodeJwe(token: string): Jwe | null {
  if (token.length < 16 || token.length > 16_384) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) return null;
  const [header, wrapped, iv, ciphertext, tag] = parts as [string, string, string, string, string];
  // A256KW wraps a 32-byte CEK into 40 bytes (54 chars); a GCM IV is 12 bytes
  // (16 chars) and its tag 16 bytes (22 chars).
  if (wrapped.length !== 54 || iv.length !== 16 || tag.length !== 22 || !ciphertext || !header) return null;
  const raw = fromB64url(header);
  if (!raw) return null;
  try {
    const h = JSON.parse(strictUtf8(raw)) as Record<string, unknown> | null;
    // `zip` and `crit` are refused: Play sets neither, and honouring either is code this verifier does not have.
    if (!h || typeof h !== 'object' || h.alg !== JWE_ALG || h.enc !== JWE_ENC || 'zip' in h || 'crit' in h) return null;
  } catch {
    return null;
  }
  const w = fromB64url(wrapped);
  const i = fromB64url(iv);
  const c = fromB64url(ciphertext);
  const t = fromB64url(tag);
  return w && i && c && t ? { header, wrappedKey: w, iv: i, ciphertext: c, tag: t } : null;
}

/**
 * ⏱ 2026-09-30 (second review of #1070, finding 1a), tightened 2026-10-03
 * (O-PLAY-INTEGRITY-LOCAL-VERIFY): whether `token` is SHAPED like a classic
 * self-managed integrity token — a compact JWE of five base64url segments whose
 * protected header is JSON naming alg A256KW and enc A256GCM, with a 54-char
 * wrapped key, a 16-char IV, a 22-char tag and a non-empty ciphertext, inside
 * the length bound. Pure and cheap, so the route answers a malformed proof 400
 * BEFORE any limiter or crypto is spent on it.
 */
export function plausibleIntegrityToken(token: string): boolean {
  return decodeJwe(token) !== null;
}

/** Decrypts the JWE (RFC 7516 §5.2: unwrap the CEK, AES-GCM with the protected header as AAD). Null on any failure. */
async function decryptJwe(jwe: Jwe, kek: CryptoKey): Promise<Uint8Array | null> {
  try {
    const cek = await crypto.subtle.unwrapKey('raw', jwe.wrappedKey, kek, { name: 'AES-KW' }, { name: 'AES-GCM' }, false, ['decrypt']);
    const sealed = new Uint8Array(jwe.ciphertext.length + jwe.tag.length);
    sealed.set(jwe.ciphertext);
    sealed.set(jwe.tag, jwe.ciphertext.length);
    const aad = new TextEncoder().encode(jwe.header);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: jwe.iv, additionalData: aad, tagLength: 128 }, cek, sealed));
  } catch {
    return null;
  }
}

/** Verifies a compact JWS (RFC 7515, ES256: a raw r ‖ s signature) and answers its payload bytes. Null on any failure. */
async function verifyJws(jws: string, spki: CryptoKey): Promise<Uint8Array | null> {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const h = fromB64url(header);
  const p = fromB64url(payload);
  const sig = fromB64url(signature);
  if (!h || !p || !sig || sig.length !== 64) return null;
  try {
    const hj = JSON.parse(strictUtf8(h)) as Record<string, unknown> | null;
    if (!hj || typeof hj !== 'object' || hj.alg !== 'ES256' || 'crit' in hj) return null;
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, spki, sig, new TextEncoder().encode(`${header}.${payload}`));
    return ok ? p : null;
  } catch {
    return null;
  }
}

/**
 * Decrypts `token`, verifies Google's signature over the verdict, and grades it
 * — all in the Worker, with no network call. Every failure is a refusal
 * (`ok: false`): nothing here is ever "unavailable", because nothing here
 * depends on anyone else being up.
 */
export async function verifyPlayIntegrity(
  token: string,
  pkg: string,
  requestHash: string,
  keys: PlayKeys,
  pins: CertPins,
  now: number,
): Promise<PlayVerdict> {
  const jwe = decodeJwe(token);
  if (!jwe) return { ok: false, why: 'token shape' };
  const { kek, spki } = importedKeys(keys);
  let kekKey: CryptoKey;
  let spkiKey: CryptoKey;
  try {
    [kekKey, spkiKey] = await Promise.all([kek, spki]);
  } catch {
    // A key that parsed but WebCrypto refuses (a point off the curve): refused, and
    // the next request retries the import rather than meeting a cached rejection.
    resetPlayIntegrityKeyCache();
    return { ok: false, why: 'key import' };
  }
  const plain = await decryptJwe(jwe, kekKey);
  if (!plain) return { ok: false, why: 'decrypt' };
  let jws: string;
  try {
    jws = strictUtf8(plain);
  } catch {
    return { ok: false, why: 'decrypt' };
  }
  const payload = await verifyJws(jws, spkiKey);
  if (!payload) return { ok: false, why: 'signature' };
  let verdict: unknown;
  try {
    verdict = JSON.parse(strictUtf8(payload));
  } catch {
    return { ok: false, why: 'payload' };
  }
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) return { ok: false, why: 'payload' };
  return gradeVerdict(verdict as Payload, pkg, requestHash, pins, now);
}
