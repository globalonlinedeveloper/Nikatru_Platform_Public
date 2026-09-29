// ─────────────────────────────────────────────────────────────────────────────
// native-attest — WHO may use the captcha-free native sign-in route
// (⏱ 2026-09-29, ADR no.NNN "native sign-in serves only attested app installs").
//
// 🔴 THE DEFECT THIS CLOSES. routes/native-auth.ts forwards the password grant,
// /signup, /recover and /resend to GoTrue with the service-role bearer, which
// skips GoTrue's Turnstile captcha. Until this module, the only test that a
// caller was an app was a MISSING `Origin` header — any script could send the
// request and get captcha-free sign-in and sign-up, bounded by rate limits alone.
//
// Every op now carries an ATTESTATION bound to a single-use server challenge and
// to the exact request body (the wire protocol is in the ADR; the client half is
// packages/core native_attest.dart + packages/auth_supabase):
//
//   clientData = "nk-native-auth/v1\n<app>\n<op>\n<challenge>\n<b64url SHA-256(body)>"
//
//   kind            proof                                         strength
//   play-integrity  Play Integrity verdict, nonce = SHA-256(cD)   the app binary + device, Google-signed
//   app-attest      App Attest assertion over SHA-256(cD)         the app binary + device, Apple-signed
//   install-key     Ed25519 signature by a per-install key        NONE about the binary — see below
//
// ⚠️ THE RESIDUAL RISK, STATED WHERE IT LIVES. Windows, Linux and a macOS build
// outside the Mac App Store have no platform attestation. `install-key` proves
// only "the same install that registered this key", and a script can register
// keys too. What bounds it instead: a much tighter per-network ceiling on its
// ops (NATIVE_AUTH_UNATTESTED_LIMITER) and on key registration
// (NATIVE_AUTH_INSTALL_LIMITER), and NO SESSION BEFORE EMAIL VERIFICATION on
// that channel — the route withholds any session a sign-up would return, and a
// password grant for an unconfirmed address. A bot that picks this channel gets
// rate-limited sign-up that ends in an unclicked email, and password guessing at
// a fraction of a network's budget. That is the floor the ADR records.
//
// FAIL CLOSED, EVERYWHERE: a kind not listed in NATIVE_AUTH_ATTEST_KINDS is
// 403; a listed kind whose server config is missing is 503; a challenge is
// consumed by the first request that presents it, pass or fail.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from '../../types';
import { b64url, fromB64, fromB64url, sha256 } from './bytes';
import { appleRootDer, verifyAssertion, verifyAttestation } from './app-attest';
import { parseServiceAccount, pinsFor, verifyPlayIntegrity } from './play-integrity';

export const ATTEST_KINDS = ['play-integrity', 'app-attest', 'install-key'] as const;
export type AttestKind = (typeof ATTEST_KINDS)[number];

export const BINDING_PREFIX = 'nk-native-auth/v1';

/**
 * How long an issued challenge stays redeemable.
 *
 * @ceiling none — a FRESHNESS bound on a single-use input, not a platform
 * resource: long enough for a Play Integrity or App Attest round trip on a slow
 * phone, short enough that a harvested challenge is worthless.
 */
export const NATIVE_ATTEST_CHALLENGE_TTL_SECONDS = 120;

export const HEADER = {
  kind: 'x-nk-attest-kind',
  challenge: 'x-nk-attest-challenge',
  key: 'x-nk-attest-key',
  proof: 'x-nk-attest-proof',
} as const;

export type AttestOp = 'token' | 'signup' | 'recover' | 'resend' | 'install';

/** The binding every proof covers. */
export async function clientDataFor(app: string, op: AttestOp, challenge: string, body: Uint8Array): Promise<string> {
  return [BINDING_PREFIX, app, op, challenge, b64url(await sha256(body))].join('\n');
}

/** The kinds this deploy accepts: NATIVE_AUTH_ATTEST_KINDS, comma-separated. Absent ⇒ none. */
export function enabledKinds(env: Pick<Env, 'NATIVE_AUTH_ATTEST_KINDS'>): Set<AttestKind> {
  const listed = (env.NATIVE_AUTH_ATTEST_KINDS ?? '').split(',').map((s) => s.trim());
  return new Set(ATTEST_KINDS.filter((k) => listed.includes(k)));
}

/** Whether the server holds what `kind` needs to verify anything for `app`. */
export function configured(env: Env, kind: AttestKind, app: string): boolean {
  if (!env.PLATFORM_DB) return false;
  if (kind === 'play-integrity') {
    return parseServiceAccount(env.PLAY_INTEGRITY_SERVICE_ACCOUNT) !== null && pinsFor(env.PLAY_INTEGRITY_CERT_DIGESTS, app) !== null;
  }
  if (kind === 'app-attest') return typeof env.APP_ATTEST_TEAM_ID === 'string' && /^[A-Z0-9]{10}$/.test(env.APP_ATTEST_TEAM_ID);
  return true;
}

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export interface AttestHeaders {
  kind: string;
  challenge: string;
  key: string | null;
  proof: string;
}

/** The four headers, shape-checked. Null when any required one is missing or malformed. */
export function readHeaders(h: Headers): AttestHeaders | null {
  const kind = h.get(HEADER.kind);
  const challenge = h.get(HEADER.challenge);
  const proof = h.get(HEADER.proof);
  const key = h.get(HEADER.key);
  if (!kind || !challenge || !proof || !CHALLENGE.test(challenge) || proof.length > 16_384) return null;
  if (key !== null && (key.length === 0 || key.length > 128)) return null;
  return { kind, challenge, key, proof };
}

export const isKind = (k: string): k is AttestKind => (ATTEST_KINDS as readonly string[]).includes(k);

const iso = (ms: number) => new Date(ms).toISOString();

/** Mints and stores a challenge. Only its SHA-256 is written. */
export async function issueChallenge(db: D1Database, app: string, now: number): Promise<string> {
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await db
    .prepare('INSERT INTO native_attest_challenges (challenge_hash, app_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(b64url(await sha256(challenge)), app, iso(now), iso(now + NATIVE_ATTEST_CHALLENGE_TTL_SECONDS * 1000))
    .run();
  return challenge;
}

/** Deletes the challenge if it is this app's and unexpired. True exactly once per challenge. */
export async function consumeChallenge(db: D1Database, app: string, challenge: string, now: number): Promise<boolean> {
  const r = await db
    .prepare('DELETE FROM native_attest_challenges WHERE challenge_hash = ? AND app_id = ? AND expires_at > ?')
    .bind(b64url(await sha256(challenge)), app, iso(now))
    .run();
  return r.meta.changes === 1;
}

interface KeyRow {
  kind: string;
  public_key: string;
  sign_count: number;
}

export type Outcome =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: 'attestation_invalid' | 'attestation_key_unknown' | 'native_auth_unavailable'; why: string };

const invalid = (why: string): Outcome => ({ ok: false, status: 401, code: 'attestation_invalid', why });

/** The App ID App Attest binds: `<TEAM ID>.com.nikatru.<app>`. */
const appleAppId = (env: Env, app: string) => `${env.APP_ATTEST_TEAM_ID}.com.nikatru.${app}`;

/** Verifies an op's proof. The challenge has already been consumed. */
export async function verifyOp(env: Env, app: string, kind: AttestKind, h: AttestHeaders, clientData: string, now: number): Promise<Outcome> {
  const db = env.PLATFORM_DB;
  if (kind === 'play-integrity') {
    const sa = parseServiceAccount(env.PLAY_INTEGRITY_SERVICE_ACCOUNT);
    const pins = pinsFor(env.PLAY_INTEGRITY_CERT_DIGESTS, app);
    if (!sa || !pins) return { ok: false, status: 503, code: 'native_auth_unavailable', why: 'play-integrity unconfigured' };
    const v = await verifyPlayIntegrity(h.proof, `com.nikatru.${app}`, b64url(await sha256(clientData)), sa, pins, now);
    if (v.ok) return { ok: true };
    return v.unavailable ? { ok: false, status: 503, code: 'native_auth_unavailable', why: v.why } : invalid(v.why);
  }

  if (!h.key) return invalid('no key id');
  const row = await db
    .prepare('SELECT kind, public_key, sign_count FROM native_attest_keys WHERE app_id = ? AND key_id = ?')
    .bind(app, h.key)
    .first<KeyRow>();
  if (!row || row.kind !== kind) return { ok: false, status: 401, code: 'attestation_key_unknown', why: 'unregistered key' };
  const publicKey = fromB64url(row.public_key);
  const proof = fromB64url(h.proof);
  if (!publicKey || !proof) return invalid('encoding');

  if (kind === 'app-attest') {
    const r = await verifyAssertion(proof, publicKey, await sha256(clientData), appleAppId(env, app), row.sign_count);
    if (!r.ok) return invalid(r.why);
    // Compare-and-set: of two requests replaying one assertion, only one moves the counter.
    const cas = await db
      .prepare('UPDATE native_attest_keys SET sign_count = ?, last_used_at = ? WHERE app_id = ? AND key_id = ? AND sign_count < ?')
      .bind(r.counter, iso(now), app, h.key, r.counter)
      .run();
    return cas.meta.changes === 1 ? { ok: true } : invalid('counter raced');
  }

  // install-key
  if (!(await ed25519Verify(publicKey, proof, clientData))) return invalid('signature');
  await db.prepare('UPDATE native_attest_keys SET last_used_at = ? WHERE app_id = ? AND key_id = ?').bind(iso(now), app, h.key).run();
  return { ok: true };
}

async function ed25519Verify(publicKey: Uint8Array, signature: Uint8Array, message: string): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

export type InstallOutcome = { ok: true; keyId: string; created: boolean } | Exclude<Outcome, { ok: true }> | { ok: false; status: 400; code: 'validation_failed'; why: string };

/**
 * Registers an install's key. The body names the key; the proof is the
 * attestation (app-attest) or a signature by the key itself (install-key,
 * proof of possession). The challenge has already been consumed.
 */
export async function registerKey(
  env: Env,
  app: string,
  kind: 'app-attest' | 'install-key',
  body: Record<string, unknown>,
  h: AttestHeaders,
  clientData: string,
  now: number,
): Promise<InstallOutcome> {
  const bad = (why: string) => ({ ok: false as const, status: 400 as const, code: 'validation_failed' as const, why });
  const proof = fromB64url(h.proof);
  if (!proof) return invalid('encoding') as InstallOutcome;
  let keyId: string;
  let publicKey: Uint8Array;

  if (kind === 'install-key') {
    const pk = typeof body.public_key === 'string' ? fromB64url(body.public_key) : null;
    if (!pk || pk.length !== 32) return bad('public_key must be a base64url Ed25519 key');
    if (!(await ed25519Verify(pk, proof, clientData))) return invalid('proof of possession') as InstallOutcome;
    keyId = b64url(await sha256(pk));
    publicKey = pk;
  } else {
    const raw = typeof body.key_id === 'string' ? fromB64(body.key_id) : null;
    if (!raw || raw.length !== 32) return bad('key_id must be an App Attest key identifier');
    const r = await verifyAttestation(proof, raw, await sha256(clientData), {
      appId: appleAppId(env, app),
      allowDevelopment: env.APP_ATTEST_ALLOW_DEVELOPMENT === 'true',
      rootDer: appleRootDer(),
      now,
    });
    if (!r.ok) return invalid(r.why) as InstallOutcome;
    keyId = body.key_id as string;
    publicKey = r.spki;
  }

  const ins = await env.PLATFORM_DB.prepare(
    'INSERT INTO native_attest_keys (app_id, key_id, kind, public_key, sign_count, created_at, last_used_at) VALUES (?, ?, ?, ?, 0, ?, ?) ON CONFLICT(app_id, key_id) DO NOTHING',
  )
    .bind(app, keyId, kind, b64url(publicKey), iso(now), iso(now))
    .run();
  return { ok: true, keyId, created: ins.meta.changes === 1 };
}
