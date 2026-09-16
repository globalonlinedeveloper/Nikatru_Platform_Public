// ─────────────────────────────────────────────────────────────────────────────
// apple-revoke.ts — REVOKING THE USER'S SIGN IN WITH APPLE TOKENS WHEN THEIR
// ACCOUNT IS DELETED (row O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE).
//
// ── WHAT APPLE REQUIRES, QUOTED FROM APPLE'S OWN DOCUMENTATION (read 2026-09-16)
//   · Endpoint: `POST https://appleid.apple.com/auth/revoke`, and Apple calls it
//     "the only way to programmatically invalidate user tokens associated to your
//     developer account without user interaction".
//   · Body: `application/x-www-form-urlencoded` with `client_id`, `client_secret`
//     and `token`; `token_type_hint` names which kind of token is being revoked.
//   · Response: "expected to return a 200 status code when the provided token has
//     been revoked or when the token was previously invalid. There is no response
//     body for these requests." So 200 is the ONLY success signal, and a revoked
//     token and an already-invalid one are indistinguishable — which is why this
//     module treats 200 as done and never re-reads anything.
//   · `client_secret` is a JWT: header `alg: ES256` + `kid` (the key id), claims
//     `iss` (Team ID), `sub` (the client id the token was issued to), `aud`
//     `https://appleid.apple.com`, `iat` and `exp` — "Apple doesn't accept client
//     secret JWTs with an expiration date more than six months after the
//     creation". This module mints one per call with a short life, so nothing
//     long-lived is stored anywhere.
//
// ── WHY WE HAVE TO HOLD A TOKEN AT ALL ──────────────────────────────────────
// Supabase hands `provider_refresh_token` to the client in the session that
// completes the OAuth redirect and keeps none of it ("Supabase does not store them
// for security reasons… it is up to you to store somewhere", supabase/auth
// discussions #22578 / #22653), and supabase/auth#1308 — "Revoke Sign in with
// Apple tokens" — is closed as NOT PLANNED. GoTrue will not do this for us, and
// the token reaches nobody else, so the app posts it here (PUT /v1/account/
// apple-token) and `apple_provider_tokens` holds it until the account is deleted.
//
// ── 🔴 CREDENTIAL ABSENT ⇒ REFUSE LOUDLY, NEVER SILENTLY SKIP ───────────────
// The four values below are OWNER-PROVISIONED (see the PR body and the README):
// the Sign in with Apple key is created in the Apple developer portal, and no
// agent creates or downloads it. Until they are set, an account WITH a stored
// Apple token cannot be revoked — so this returns `blocked`, the deletion route
// records a pending erasure step and answers 202, the identity is NOT deleted,
// and the nightly retry keeps trying. What it must never do is delete the account
// and report success while Apple still lists this app as connected.
//
// Nothing here logs a token, a client secret or a key: every log line is a COUNT
// or a status.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from '../types';

/** Apple's revocation endpoint (quoted in the header above). */
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
/** The `aud` every Sign in with Apple client secret must carry. */
export const APPLE_AUD = 'https://appleid.apple.com';
/** @ceiling none — the life of a client-secret JWT minted per call, not a
 *  platform resource. Apple's cap is six months; this is minutes because the JWT
 *  is made, used once and dropped. */
export const CLIENT_SECRET_TTL_SECONDS = 300;

/** What the revoke attempt did. Every caller must handle all four. */
export type AppleRevokeOutcome =
  | { kind: 'none' }
  | { kind: 'revoked' }
  | { kind: 'blocked'; why: string }
  | { kind: 'transient'; why: string };

export interface AppleRevokeCredentials {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKeyPem: string;
}

/**
 * The four owner-provisioned values, or null with the names of the missing ones.
 *
 * Returned as a NAMED absence rather than as a boolean: the deletion route puts
 * the names into its refusal log, so an operator reading it knows exactly which
 * `wrangler secret put` is missing.
 */
export function appleRevokeCredentials(env: Env): { ok: AppleRevokeCredentials } | { missing: string[] } {
  const wanted: Array<[keyof Env, string]> = [
    ['APPLE_REVOKE_CLIENT_ID', 'APPLE_REVOKE_CLIENT_ID'],
    ['APPLE_REVOKE_TEAM_ID', 'APPLE_REVOKE_TEAM_ID'],
    ['APPLE_REVOKE_KEY_ID', 'APPLE_REVOKE_KEY_ID'],
    ['APPLE_REVOKE_PRIVATE_KEY', 'APPLE_REVOKE_PRIVATE_KEY'],
  ];
  const missing = wanted.filter(([k]) => typeof env[k] !== 'string' || (env[k] as string).trim() === '').map(([, n]) => n);
  if (missing.length > 0) return { missing };
  return {
    ok: {
      clientId: (env.APPLE_REVOKE_CLIENT_ID as string).trim(),
      teamId: (env.APPLE_REVOKE_TEAM_ID as string).trim(),
      keyId: (env.APPLE_REVOKE_KEY_ID as string).trim(),
      privateKeyPem: env.APPLE_REVOKE_PRIVATE_KEY as string,
    },
  };
}

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** The DER bytes of a PKCS#8 `-----BEGIN PRIVATE KEY-----` PEM — the shape Apple
 *  hands out as a `.p8`. Whitespace and the armour are stripped; anything else
 *  throws, because a key that "almost" parses is a revoke that fails at Apple. */
export function pkcs8DerFromPem(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  // The length check is not pedantry: `atob` is lenient about a truncated final
  // quantum, so without it a mangled key decodes to plausible bytes and the
  // failure surfaces as Apple's `invalid_client` on a live deletion instead of
  // here. Base64 of DER is always a multiple of four characters.
  if (body === '' || body.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(body)) {
    throw new Error('the Sign in with Apple private key is not a PKCS#8 PEM');
  }
  let raw: string;
  try {
    raw = atob(body);
  } catch {
    throw new Error('the Sign in with Apple private key is not a PKCS#8 PEM');
  }
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The `client_secret` JWT Apple's token endpoints take, signed ES256 with the
 * owner's Sign in with Apple key. `nowS` is injected so a test pins the claims
 * rather than racing a clock.
 */
export async function appleClientSecret(c: AppleRevokeCredentials, nowS: number): Promise<string> {
  const header = { alg: 'ES256', kid: c.keyId, typ: 'JWT' };
  const claims = {
    iss: c.teamId,
    iat: nowS,
    exp: nowS + CLIENT_SECRET_TTL_SECONDS,
    aud: APPLE_AUD,
    sub: c.clientId,
  };
  const signingInput = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8DerFromPem(c.privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto's ECDSA output is already the raw r‖s pair JWS requires; a DER
  // signature here would be refused by Apple as a malformed client secret.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signingInput)),
  );
  return `${signingInput}.${b64url(sig)}`;
}

/** The stored Apple refresh token for a subject, or null. */
export async function storedAppleToken(db: D1Database, subjectRef: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT refresh_token FROM apple_provider_tokens WHERE subject_ref = ?')
    .bind(subjectRef)
    .first<{ refresh_token: string }>();
  return row?.refresh_token ?? null;
}

/** Keep (or replace) the token this subject's last Apple sign-in produced.
 *  `appId` is the provenance marker the monitor attributes the row by. */
export async function putAppleToken(
  db: D1Database,
  subjectRef: string,
  appId: string,
  refreshToken: string,
  nowIso: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO apple_provider_tokens (subject_ref, app_id, refresh_token, stored_at) VALUES (?,?,?,?)
       ON CONFLICT (subject_ref) DO UPDATE SET
         app_id = excluded.app_id,
         refresh_token = excluded.refresh_token,
         stored_at = excluded.stored_at`,
    )
    .bind(subjectRef, appId, refreshToken, nowIso)
    .run();
}

/** Forget the token — after a successful revoke, or when the erasure is over. */
export async function dropAppleToken(db: D1Database, subjectRef: string): Promise<void> {
  await db.prepare('DELETE FROM apple_provider_tokens WHERE subject_ref = ?').bind(subjectRef).run();
}

/**
 * Revoke this subject's Apple token, and forget it once Apple has answered 200.
 *
 * `rid` only ever reaches a log line; the token never does.
 */
export async function revokeAppleToken(env: Env, subjectRef: string, rid: string): Promise<AppleRevokeOutcome> {
  let token: string | null;
  try {
    token = await storedAppleToken(env.PLATFORM_DB, subjectRef);
  } catch (err) {
    return { kind: 'transient', why: `apple token read failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
  // No token is not "nothing to do about Apple" in general — it is "this account
  // never signed in with Apple on a build that kept one", which is every account
  // created before this shipped. There is nothing to revoke and nothing to retry.
  if (token === null) return { kind: 'none' };

  const creds = appleRevokeCredentials(env);
  if ('missing' in creds) {
    console.error(
      `[apple-revoke] rid=${rid} REFUSING to finish this deletion: a Sign in with Apple token is stored for this subject and ` +
        `these secrets are not set: ${creds.missing.join(', ')}. The deletion stays pending and is retried; it is NOT reported as done.`,
    );
    return { kind: 'blocked', why: `missing ${creds.missing.join(',')}` };
  }

  let secret: string;
  try {
    secret = await appleClientSecret(creds.ok, Math.floor(Date.now() / 1000));
  } catch (err) {
    console.error(`[apple-revoke] rid=${rid} could not mint the client secret`, err instanceof Error ? err.message : err);
    return { kind: 'blocked', why: 'client secret could not be minted' };
  }

  let res: Response;
  try {
    res = await fetch(APPLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.ok.clientId,
        client_secret: secret,
        token,
        token_type_hint: 'refresh_token',
      }).toString(),
    });
  } catch (err) {
    return { kind: 'transient', why: `apple unreachable: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  if (res.ok) {
    try {
      await dropAppleToken(env.PLATFORM_DB, subjectRef);
    } catch (err) {
      // Revoked at Apple, still on our side: a retry would revoke an already
      // invalid token, which Apple answers 200 for, so the retry is harmless.
      console.error(`[apple-revoke] rid=${rid} revoked, but the stored token could not be deleted`, err);
      return { kind: 'transient', why: 'token row could not be deleted after revoke' };
    }
    console.log(`[apple-revoke] rid=${rid} revoked 1 Sign in with Apple token`);
    return { kind: 'revoked' };
  }

  // 🔴 A 4xx IS OURS, NOT APPLE'S OUTAGE. `invalid_client` means the client id,
  // team id, key id or key disagree with what the token was issued to, and
  // retrying that forever would keep answering 202 while nothing improves. It is
  // still not a silent skip: the deletion stays pending and the log names it.
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    console.error(`[apple-revoke] rid=${rid} Apple refused the revoke with ${res.status} — the credentials do not match this token`);
    return { kind: 'blocked', why: `apple answered ${res.status}` };
  }
  return { kind: 'transient', why: `apple answered ${res.status}` };
}
