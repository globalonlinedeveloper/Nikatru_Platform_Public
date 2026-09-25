// ─────────────────────────────────────────────────────────────────────────────
// provider-revoke.ts — REVOKING THE USER'S IDENTITY-PROVIDER TOKENS WHEN THEIR
// ACCOUNT IS DELETED: Sign in with Apple (row O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE)
// and Google (row O-GOOGLE-SIGN-IN-NOT-BUILT, the server half).
//
// ⏱ 2026-09-24 · MOVED FROM apple-revoke.ts, and the Apple limb is unchanged in
// behaviour except that its call now has a timeout ceiling. One function per
// provider, behind one [revokeProviderTokens], because a deletion owes the revoke
// to every provider the account signed in through, and each one settles or stays
// pending on its own ledger step.
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
// ── WHAT GOOGLE REQUIRES (OAuth 2.0 for web server apps, "Revoking a token") ──
//   · Endpoint: `POST https://oauth2.googleapis.com/revoke`, body
//     `application/x-www-form-urlencoded` with the single field `token`. Revoking
//     a refresh token revokes the grant it belongs to.
//   · NO CLIENT CREDENTIAL. The call carries the token and nothing else — no
//     `client_id`, no `client_secret`, no Authorization header — so the Google
//     limb reads no Worker secret at all, and there is no `GOOGLE_*` key to
//     provision. If one ever seems needed here, the design has changed: stop.
//   · 200 is revoked. 400 `{"error":"invalid_token"}` is a token that is already
//     revoked or expired — nothing is left to revoke, so it SETTLES as `none`
//     rather than keeping a deletion pending on a token nobody can use.
//
// ── WHY WE HAVE TO HOLD A TOKEN AT ALL ──────────────────────────────────────
// Supabase hands `provider_refresh_token` to the client in the session that
// completes the OAuth redirect and keeps none of it ("Supabase does not store them
// for security reasons… it is up to you to store somewhere", supabase/auth
// discussions #22578 / #22653), and supabase/auth#1308 — "Revoke Sign in with
// Apple tokens" — is closed as NOT PLANNED. GoTrue will not do this for us, and
// the token reaches nobody else, so the app posts it here (PUT /v1/account/
// provider-token, or the Apple-only alias PUT /v1/account/apple-token) and
// `provider_tokens` holds it until the account is deleted.
//
// ── 🔴 CREDENTIAL ABSENT ⇒ REFUSE LOUDLY, NEVER SILENTLY SKIP ───────────────
// Apple's four values below are OWNER-PROVISIONED (see the PR body and the
// README): the Sign in with Apple key is created in the Apple developer portal,
// and no agent creates or downloads it. Until they are set, an account WITH a
// stored Apple token cannot be revoked — so this returns `blocked`, the deletion
// route records a pending erasure step and answers 202, the identity is NOT
// deleted, and the nightly retry keeps trying. What it must never do is delete
// the account and report success while Apple still lists this app as connected.
//
// Nothing here logs a token, a client secret or a key: every log line is a COUNT
// or a status.
//
// ⚠️ 0012's `apple_provider_tokens` is RETIRED by 0016 and nothing here reads or
// writes it; [dropProviderTokens] deletes an erased subject's row from it, which
// is the only statement left that names it.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from '../types';
import { APPLE_REVOKE_STEP, GOOGLE_REVOKE_STEP } from './erasure-ledger';

/** The identity providers whose tokens this Worker keeps and revokes. The same
 *  two values migrations/0016_provider_tokens.sql CHECKs `provider` against. */
export type ProviderName = 'apple' | 'google';
export const PROVIDER_NAMES: readonly ProviderName[] = ['apple', 'google'];

export function isProviderName(value: unknown): value is ProviderName {
  return value === 'apple' || value === 'google';
}

/** Each provider's [ADR 081] ledger step, in one place for the route and the cron. */
export const REVOKE_STEPS: Readonly<Record<ProviderName, string>> = {
  apple: APPLE_REVOKE_STEP,
  google: GOOGLE_REVOKE_STEP,
};

/** The provider a ledger step revokes for, or null when the step is not a revoke. */
export function providerOfRevokeStep(step: string): ProviderName | null {
  for (const p of PROVIDER_NAMES) if (REVOKE_STEPS[p] === step) return p;
  return null;
}

/** Apple's revocation endpoint (quoted in the header above). */
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
/** Google's revocation endpoint (quoted in the header above). */
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
/** The `aud` every Sign in with Apple client secret must carry. */
export const APPLE_AUD = 'https://appleid.apple.com';
/** @ceiling none — the life of a client-secret JWT minted per call, not a
 *  platform resource. Apple's cap is six months; this is minutes because the JWT
 *  is made, used once and dropped. */
export const CLIENT_SECRET_TTL_SECONDS = 300;

/**
 * How long one revoke call may take before it counts as unreachable.
 *
 * @ceiling none — a CLIENT-SIDE PATIENCE BUDGET on an outbound call, not a
 * platform resource, the same kind as checkout.ts `PADDLE_CREATE_TIMEOUT_MS`. It
 * exists because a provider that accepts the connection and never answers would
 * otherwise hold the deletion request, or the nightly retry beat, open with it.
 * A timeout is `transient`: the step stays pending and the retry tries again.
 */
export const PROVIDER_REVOKE_TIMEOUT_MS = 10_000;

/** What one revoke attempt did. Every caller must handle all four. */
export type RevokeOutcome =
  | { kind: 'none' }
  | { kind: 'revoked' }
  | { kind: 'blocked'; why: string }
  | { kind: 'transient'; why: string };

/** The Apple limb's name for [RevokeOutcome], kept for existing importers. */
export type AppleRevokeOutcome = RevokeOutcome;

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

/** The stored refresh token for a (subject, provider), or null. */
export async function storedProviderToken(
  db: D1Database,
  subjectRef: string,
  provider: ProviderName,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT refresh_token FROM provider_tokens WHERE subject_ref = ? AND provider = ?')
    .bind(subjectRef, provider)
    .first<{ refresh_token: string }>();
  return row?.refresh_token ?? null;
}

/** Keep (or replace) the token this subject's last sign-in with `provider`
 *  produced. `appId` is the provenance marker the monitor attributes the row by. */
export async function putProviderToken(
  db: D1Database,
  subjectRef: string,
  provider: ProviderName,
  appId: string,
  refreshToken: string,
  nowIso: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO provider_tokens (subject_ref, provider, app_id, refresh_token, stored_at) VALUES (?,?,?,?,?)
       ON CONFLICT (subject_ref, provider) DO UPDATE SET
         app_id = excluded.app_id,
         refresh_token = excluded.refresh_token,
         stored_at = excluded.stored_at`,
    )
    .bind(subjectRef, provider, appId, refreshToken, nowIso)
    .run();
}

/** Forget one provider's token — after its revoke settled. */
export async function dropProviderToken(db: D1Database, subjectRef: string, provider: ProviderName): Promise<void> {
  await db.prepare('DELETE FROM provider_tokens WHERE subject_ref = ? AND provider = ?').bind(subjectRef, provider).run();
}

/**
 * Forget every provider's token for a subject — when the erasure is over.
 *
 * ⚠️ AND THE SUBJECT'S ROW IN THE RETIRED 0012 TABLE, which is the ONE statement
 * left that touches `apple_provider_tokens`, and it only ever deletes. Since 0016
 * nothing reads or writes that table, but 0016 COPIED its rows rather than moving
 * them, so without this an erased account's copy — its subject id and a token
 * already revoked through the `provider_tokens` copy — would outlive the erasure
 * until the later migration drops the table. That migration removes this line.
 */
export async function dropProviderTokens(db: D1Database, subjectRef: string): Promise<void> {
  await db.prepare('DELETE FROM provider_tokens WHERE subject_ref = ?').bind(subjectRef).run();
  await db.prepare('DELETE FROM apple_provider_tokens WHERE subject_ref = ?').bind(subjectRef).run();
}

/** The stored token, or the `transient` outcome a failed read has to be. */
async function readToken(
  env: Env,
  subjectRef: string,
  provider: ProviderName,
): Promise<{ token: string | null } | { failed: RevokeOutcome }> {
  try {
    return { token: await storedProviderToken(env.PLATFORM_DB, subjectRef, provider) };
  } catch (err) {
    return { failed: { kind: 'transient', why: `${provider} token read failed: ${err instanceof Error ? err.message : 'unknown'}` } };
  }
}

/** Forget the token once its provider has settled it, or say why that failed. */
async function settle(
  env: Env,
  subjectRef: string,
  provider: ProviderName,
  rid: string,
  outcome: RevokeOutcome,
): Promise<RevokeOutcome> {
  try {
    await dropProviderToken(env.PLATFORM_DB, subjectRef, provider);
  } catch (err) {
    // Settled at the provider, still on our side: a retry revokes a token that
    // is already invalid, which both providers answer as settled, so it is harmless.
    console.error(`[${provider}-revoke] rid=${rid} settled, but the stored token could not be deleted`, err);
    return { kind: 'transient', why: 'token row could not be deleted after revoke' };
  }
  return outcome;
}

/**
 * Revoke this subject's Apple token, and forget it once Apple has answered 200.
 *
 * `rid` only ever reaches a log line; the token never does.
 */
export async function revokeAppleToken(env: Env, subjectRef: string, rid: string): Promise<RevokeOutcome> {
  const read = await readToken(env, subjectRef, 'apple');
  if ('failed' in read) return read.failed;
  const token = read.token;
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
      signal: AbortSignal.timeout(PROVIDER_REVOKE_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: 'transient', why: `apple unreachable: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  if (res.ok) {
    const settled = await settle(env, subjectRef, 'apple', rid, { kind: 'revoked' });
    if (settled.kind === 'revoked') console.log(`[apple-revoke] rid=${rid} revoked 1 Sign in with Apple token`);
    return settled;
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

/**
 * Revoke this subject's Google token, and forget it once Google has settled it.
 *
 * Needs no Worker secret: the request carries the token and nothing else.
 * `rid` only ever reaches a log line; the token never does.
 */
export async function revokeGoogleToken(env: Env, subjectRef: string, rid: string): Promise<RevokeOutcome> {
  const read = await readToken(env, subjectRef, 'google');
  if ('failed' in read) return read.failed;
  const token = read.token;
  // Every account that never signed in with Google on a build that kept a token.
  if (token === null) return { kind: 'none' };

  let res: Response;
  try {
    res = await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      // No Authorization header and no client credential, by Google's design.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(PROVIDER_REVOKE_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: 'transient', why: `google unreachable: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  if (res.ok) {
    const settled = await settle(env, subjectRef, 'google', rid, { kind: 'revoked' });
    if (settled.kind === 'revoked') console.log(`[google-revoke] rid=${rid} revoked 1 Google token`);
    return settled;
  }

  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    // Already revoked or expired: the grant this token stood for is gone, so
    // there is nothing to revoke and nothing to retry. The row goes with it.
    if (body?.error === 'invalid_token') {
      const settled = await settle(env, subjectRef, 'google', rid, { kind: 'none' });
      if (settled.kind === 'none') console.log(`[google-revoke] rid=${rid} the stored Google token was already invalid; forgotten`);
      return settled;
    }
  }

  // Any other 4xx is a request Google will refuse again (the same reading as
  // Apple's), so it is `blocked`: pending, said out loud, not retried blind.
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    console.error(`[google-revoke] rid=${rid} Google refused the revoke with ${res.status}`);
    return { kind: 'blocked', why: `google answered ${res.status}` };
  }
  return { kind: 'transient', why: `google answered ${res.status}` };
}

/** One provider's revoke, by name — what the nightly retry runs for a revoke step. */
export function revokeProviderToken(
  provider: ProviderName,
  env: Env,
  subjectRef: string,
  rid: string,
): Promise<RevokeOutcome> {
  return provider === 'apple' ? revokeAppleToken(env, subjectRef, rid) : revokeGoogleToken(env, subjectRef, rid);
}

/**
 * Revoke every provider token this subject has, one provider at a time, and say
 * what happened at each. A provider with no stored token answers `none`.
 */
export async function revokeProviderTokens(
  env: Env,
  subjectRef: string,
  rid: string,
): Promise<Record<ProviderName, RevokeOutcome>> {
  return {
    apple: await revokeAppleToken(env, subjectRef, rid),
    google: await revokeGoogleToken(env, subjectRef, rid),
  };
}
