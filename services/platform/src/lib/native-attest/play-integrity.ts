// ─────────────────────────────────────────────────────────────────────────────
// play-integrity.ts — Google Play Integrity, server side (⏱ 2026-09-29, ADR no.NNN).
//
// The app sends a CLASSIC integrity token whose nonce is the protocol's
// requestHash (binding.ts). Google decrypts and signs the verdict; this Worker
// asks Google to decode it (the documented server path,
// playintegrity.googleapis.com v1 `decodeIntegrityToken`) with an OAuth token
// minted from a service-account key, and then grades the verdict itself:
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
// 🔴 NOTHING HERE IS ON UNTIL THE OWNER'S KEY EXISTS. The service account and
// the Play app-signing digest are both owner-provisioned; without either the
// route answers 503 for this kind — it never degrades to "no check".
// ─────────────────────────────────────────────────────────────────────────────
import { b64url, fromB64url } from './bytes';

/** How far a verdict's own timestamp may sit from now. @ceiling none — a freshness bound on an input. */
export const PLAY_INTEGRITY_MAX_SKEW_MS = 5 * 60_000;
/** Patience for one Google call. @ceiling none — a client-side budget on an outbound call. */
export const PLAY_INTEGRITY_TIMEOUT_MS = 8_000;

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/playintegrity';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

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

export function parseServiceAccount(json: string | undefined): ServiceAccount | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<ServiceAccount>;
    return typeof v.client_email === 'string' && typeof v.private_key === 'string' ? { client_email: v.client_email, private_key: v.private_key } : null;
  } catch {
    return null;
  }
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

let cached: { email: string; token: string; until: number } | null = null;

/** Test seam: forget the cached OAuth token. */
export function resetPlayIntegrityTokenCache(): void {
  cached = null;
}

function pemBody(pem: string): Uint8Array {
  const bin = atob(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, ''));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

async function accessToken(sa: ServiceAccount, now: number): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.until > now) return cached.token;
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const iat = Math.floor(now / 1000);
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URI, iat, exp: iat + 3600 })}`;
  const key = await crypto.subtle.importKey('pkcs8', pemBody(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const res = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }).toString(),
    signal: AbortSignal.timeout(PLAY_INTEGRITY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== 'string') throw new Error('oauth: no access_token');
  const ttl = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  cached = { email: sa.client_email, token: body.access_token, until: now + Math.max(0, ttl - 120) * 1000 };
  return body.access_token;
}

export type PlayVerdict = { ok: true; channel: 'play' | 'sideload' } | { ok: false; why: string; unavailable?: true };

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

/** Decodes `token` at Google and grades it. A Google fault is `unavailable` (503), never a pass. */
export async function verifyPlayIntegrity(
  token: string,
  pkg: string,
  requestHash: string,
  sa: ServiceAccount,
  pins: CertPins,
  now: number,
): Promise<PlayVerdict> {
  if (token.length < 16 || token.length > 16_384 || !/^[A-Za-z0-9._-]+$/.test(token)) return { ok: false, why: 'token shape' };
  let payload: Payload;
  try {
    const res = await fetch(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(pkg)}:decodeIntegrityToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken(sa, now)}` },
      body: JSON.stringify({ integrity_token: token }),
      signal: AbortSignal.timeout(PLAY_INTEGRITY_TIMEOUT_MS),
    });
    if (res.status === 400) return { ok: false, why: 'rejected by Google' };
    if (!res.ok) return { ok: false, why: `google ${res.status}`, unavailable: true };
    payload = ((await res.json()) as { tokenPayloadExternal?: Payload }).tokenPayloadExternal ?? {};
  } catch (err) {
    return { ok: false, why: `google unreachable (${err instanceof Error ? err.name : typeof err})`, unavailable: true };
  }
  return gradeVerdict(payload, pkg, requestHash, pins, now);
}
