// ─────────────────────────────────────────────────────────────────────────────
// bytes.ts — the byte helpers the native attestation verifiers share
// (⏱ 2026-09-29, ADR no.NNN "native sign-in serves only attested installs").
//
// Pure and dependency-free: every verifier here runs inside the Worker, on
// WebCrypto, with no npm package on the path of a sign-in decision.
// ─────────────────────────────────────────────────────────────────────────────

const B64URL = /^[A-Za-z0-9_-]*$/;
const B64STD = /^[A-Za-z0-9+/]*={0,2}$/;

/** base64url, no padding — the only encoding this protocol emits. */
export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64url (padding optional). Null when it is not base64url at all. */
export function fromB64url(text: string): Uint8Array | null {
  const bare = text.replace(/=+$/, '');
  if (!B64URL.test(bare) || bare.length % 4 === 1) return null;
  return fromBinary(atob(bare.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (bare.length % 4)) % 4)));
}

/** Decodes standard base64 (Apple's keyId is standard base64). Null when it is not. */
export function fromB64(text: string): Uint8Array | null {
  if (!B64STD.test(text) || text.length % 4 !== 0) return null;
  try {
    return fromBinary(atob(text));
  } catch {
    return null;
  }
}

function fromBinary(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Constant-time over equal lengths; unequal lengths are unequal. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
