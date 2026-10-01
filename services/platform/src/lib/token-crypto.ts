// ─────────────────────────────────────────────────────────────────────────────
// token-crypto.ts — THE PROVIDER REFRESH TOKENS ARE ENCRYPTED AT REST (review
// round 2, security: "provider refresh tokens are plain text in D1 and in every
// R2 backup").
//
// `provider_tokens` holds a live credential per (subject, provider): Apple's and
// Google's OAuth refresh tokens, kept only so a deletion can revoke them
// (migrations/0016_provider_tokens.sql). Until this module they sat in the
// `refresh_token` column as plain text, so anyone holding a D1 export or one of
// the nightly R2 backups (src/backup/) held every token. From migration 0023 on,
// the token lives in `token_ct` as AES-256-GCM ciphertext and `refresh_token`
// holds the empty string; src/lib/provider-revoke.ts is the only caller.
//
// ── THE ENVELOPE ─────────────────────────────────────────────────────────────
//   · AES-256-GCM through WebCrypto (`crypto.subtle`), no npm package: the
//     Worker runtime has it, and a token read is the input to a deletion.
//   · A FRESH RANDOM 96-BIT IV PER WRITE (`crypto.getRandomValues`), stored in
//     front of the ciphertext: `token_ct` = base64url(iv ‖ ciphertext ‖ tag).
//     Two rows holding the same token never hold the same bytes.
//   · THE ROW IS THE ADDITIONAL AUTHENTICATED DATA: table, provider, subject and
//     key id. A ciphertext moved to another subject's row, or relabelled with
//     another provider or key id, fails authentication exactly like a flipped
//     byte does — GCM's tag covers both.
//   · A FAILURE IS `null`, NEVER A GUESS. A wrong key, a tampered byte, a
//     truncated value and an unknown key id all decrypt to nothing, and the
//     caller refuses (provider-revoke.ts answers `blocked`: the deletion stays
//     pending and the log says why). No path falls back to plain text.
//
// ── THE KEY IS A WORKER SECRET, BY NAME, WITH A KEY ID FOR ROTATION ──────────
// `TOKEN_KEY_SECRETS` maps each key id to the NAME of the secret holding it;
// `CURRENT_TOKEN_KEY_ID` is the one new writes use, and each row records its
// id in `token_key_id`. The secret is 32 random bytes, standard base64
// (`openssl rand -base64 32`), put by the owner with
// `wrangler secret put TOKEN_ENC_KEY_V1`. Nothing else holds it: it is in no
// file, no var and no backup — which is what makes an R2 backup carry
// ciphertext ONLY.
//   ROTATION, when it is needed: add `v2: 'TOKEN_ENC_KEY_V2'` below (and the
//   field in src/types.ts), put that secret, make `v2` current and deploy. New
//   writes use v2; every v1 row still decrypts with V1, because a read picks
//   the key by the ROW's id. Retiring V1 then needs a re-encrypt pass over the
//   `token_key_id = 'v1'` rows — the backfill in provider-revoke.ts is the
//   shape to extend — and only after it reports zero may the V1 secret go.
//
// 🔴 ABSENT OR MALFORMED ⇒ FAIL CLOSED, NEVER PLAIN TEXT. `tokenKey` names the
// secret it could not use; a store is then REFUSED (the route answers 503), a
// read is `blocked`, the nightly backfill writes a red heartbeat, and
// `/v1/health` reports `token_encryption_key` not ok — so the post-deploy smoke
// (`--require-ok`) turns the deploy RED with that check named.
//
// ♻️ REUSED, NOT COPIED: the base64 codecs and `concat` are
// src/lib/native-attest/bytes.ts's — the Worker's one set of byte helpers.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from '../types';
import type { ProbeOutcome } from './health';
import { b64url, concat, fromB64, fromB64url } from './native-attest/bytes';

/** Each key id, and the NAME of the Worker secret that holds its key. */
export const TOKEN_KEY_SECRETS = { v1: 'TOKEN_ENC_KEY_V1' } as const satisfies Record<string, keyof Env>;
export type TokenKeyId = keyof typeof TOKEN_KEY_SECRETS;

/** The key id every new write uses. */
export const CURRENT_TOKEN_KEY_ID: TokenKeyId = 'v1';

/** The bindings a token key is read from. */
export type TokenKeyEnv = Pick<Env, 'TOKEN_ENC_KEY_V1'>;

// @ceiling none — AES-256's key length, a property of the algorithm, not a platform resource.
export const TOKEN_KEY_BYTES = 32;

// @ceiling none — GCM's 96-bit IV (NIST SP 800-38D §8.2), a property of the algorithm, not a platform resource.
export const TOKEN_IV_BYTES = 12;

// @ceiling none — GCM's full 128-bit tag, WebCrypto's default, a property of the algorithm, not a platform resource.
const TOKEN_TAG_BYTES = 16;

/** Which row a ciphertext belongs to: the additional authenticated data. */
export interface TokenRow {
  subjectRef: string;
  provider: string;
}

export function isTokenKeyId(value: unknown): value is TokenKeyId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TOKEN_KEY_SECRETS, value);
}

/**
 * The AES-GCM key for `keyId`, or the refusal naming the secret that could not
 * be used. `absent` separates "never put" from "put, and not 32 bytes of
 * base64" — the health probe reports the two differently.
 *
 * Not cached: an import costs microseconds, and a token is read or written a
 * handful of times per account lifetime. A module-scope cache would be a second
 * copy of the key material with a lifetime nobody chose.
 */
export async function tokenKey(
  env: TokenKeyEnv,
  keyId: string,
): Promise<{ key: CryptoKey } | { refused: string; absent: boolean }> {
  if (!isTokenKeyId(keyId)) return { refused: `no secret is declared for token key id ${JSON.stringify(keyId)}`, absent: false };
  const name = TOKEN_KEY_SECRETS[keyId];
  const raw = env[name];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { refused: `the Worker secret ${name} is not set`, absent: true };
  }
  const bytes = fromB64(raw.trim());
  if (bytes === null || bytes.length !== TOKEN_KEY_BYTES) {
    return { refused: `the Worker secret ${name} is not ${TOKEN_KEY_BYTES} bytes of standard base64`, absent: false };
  }
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { key };
}

/** The additional authenticated data that binds a ciphertext to its row. */
function aad(keyId: string, row: TokenRow): Uint8Array {
  return new TextEncoder().encode(`provider_tokens\u001f${row.provider}\u001f${row.subjectRef}\u001f${keyId}`);
}

/** Encrypt one token for one row under `keyId`'s key, with a fresh random IV. */
export async function encryptToken(key: CryptoKey, keyId: string, row: TokenRow, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(TOKEN_IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(keyId, row), tagLength: TOKEN_TAG_BYTES * 8 },
      key,
      new TextEncoder().encode(token),
    ),
  );
  return b64url(concat(iv, sealed));
}

/**
 * Decrypt one row's token, or `null` — for a wrong key, a tampered or
 * truncated value, or a ciphertext that belongs to another row. Never throws.
 */
export async function decryptToken(key: CryptoKey, keyId: string, row: TokenRow, sealed: string): Promise<string | null> {
  const bytes = fromB64url(sealed);
  if (bytes === null || bytes.length <= TOKEN_IV_BYTES + TOKEN_TAG_BYTES) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, TOKEN_IV_BYTES), additionalData: aad(keyId, row), tagLength: TOKEN_TAG_BYTES * 8 },
      key,
      bytes.slice(TOKEN_IV_BYTES),
    );
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plain);
  } catch {
    return null;
  }
}

/**
 * `/v1/health`'s reading of the CURRENT key: `ok` only when the secret is set,
 * is 32 bytes, and round-trips a value through AES-GCM on this runtime. The
 * reason codes are fixed strings — the endpoint is public, so the probe's NAME
 * (`token_encryption_key`) says what is wrong and the secret's name is not
 * repeated here; the Worker's own log lines and the nightly heartbeat carry it.
 */
export async function probeTokenKey(env: TokenKeyEnv): Promise<ProbeOutcome> {
  const got = await tokenKey(env, CURRENT_TOKEN_KEY_ID);
  if ('refused' in got) {
    return got.absent ? { status: 'unknown', reason: 'not_configured' } : { status: 'degraded', reason: 'key_malformed' };
  }
  const row = { subjectRef: 'health-probe', provider: 'probe' };
  const sealed = await encryptToken(got.key, CURRENT_TOKEN_KEY_ID, row, 'health-probe');
  if ((await decryptToken(got.key, CURRENT_TOKEN_KEY_ID, row, sealed)) !== 'health-probe') {
    return { status: 'degraded', reason: 'round_trip_failed' };
  }
  return { status: 'ok', reason: null };
}
