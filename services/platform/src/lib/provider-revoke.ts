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
// 🔴 ⏱ 2026-09-30 · AND NOTHING HERE STORES ONE IN PLAIN TEXT. `provider_tokens`
// holds AES-256-GCM ciphertext (src/lib/token-crypto.ts, migration 0023), under
// the owner's Worker secret TOKEN_ENC_KEY_V1; the store section below says how
// the rows written before that are backfilled and when plain text may be read.
//
// ⚠️ 0012's `apple_provider_tokens` is RETIRED by 0016. Two things here still
// name it: [dropProviderTokens] deletes an erased subject's row, and — ⏱
// 2026-09-30, only while the plain-text window is open — [backfillProviderTokens]
// re-runs 0016's copy out of it and then empties each row's token.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from '../types';
import { APPLE_REVOKE_STEP, GOOGLE_REVOKE_STEP } from './erasure-ledger';
import { CURRENT_TOKEN_KEY_ID, decryptToken, encryptToken, tokenKey } from './token-crypto';

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

// ── THE TOKEN STORE: CIPHERTEXT ONLY (⏱ 2026-09-30, review round 2, security) ──
// Every token is written as AES-256-GCM ciphertext into `token_ct`, under the
// key its `token_key_id` names (src/lib/token-crypto.ts, migration 0023), and
// `refresh_token` — the plain-text column 0016 created NOT NULL — is written as
// the empty string. What is left is the rows stored BEFORE this shipped: the
// nightly [backfillProviderTokens] encrypts them, and until it has, a revoke
// may read one only inside the PLAIN-TEXT READ WINDOW ([plaintextReadsOpen]).
//
// 🔴 ONCE THE WINDOW IS CLOSED, NOTHING READS `refresh_token`. Every statement
// that selects or filters on it is in this section and is prepared only behind
// `plaintextReadsOpen`; the one write that names it writes ''. Each is an
// inline literal at its `.prepare(` (assert-d1-sql-inventory reads them there).
// test/token-encryption.test.ts holds both halves: a census of every SQL literal
// in src/ naming the column against the statements it pins, and — with the
// window closed — the real engine's statement log, in which none may appear.

/** The bindings the token store reads: the database, the key by NAME, the window. */
export type TokenStoreEnv = Pick<Env, 'PLATFORM_DB' | 'TOKEN_ENC_KEY_V1' | 'PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL'>;

/**
 * The longest a plain-text read window may be declared ahead of today.
 *
 * @ceiling none — a SAFETY BOUND on a flag, not a platform resource. A window
 * set further ahead than this reads as CLOSED, so "2099-01-01" cannot turn the
 * flag into a permanent ON: the backfill's first night finishes it for any
 * table this estate holds, and the window only has to outlast the review and
 * the deploy of the change that opens it.
 */
export const PLAINTEXT_WINDOW_MAX_DAYS = 45;

/**
 * Rows the nightly backfill encrypts per run.
 *
 * @ceiling d1.queriesPerInvocation lte — one UPDATE per row, each its own
 * query, inside the nightly firing's invocation; the rest of a run is five
 * fixed statements. A table larger than this is finished over several nights
 * (the backfill is resumable), and the heartbeat says how many rows are left.
 */
export const MAX_TOKEN_BACKFILL_PER_RUN = 25;

/**
 * Is the plain-text read window open at `nowMs`? Only when the var is a
 * `YYYY-MM-DD` date, `nowMs` is before 00:00 UTC that day, and that is at most
 * PLAINTEXT_WINDOW_MAX_DAYS away. Absent, malformed, too far ahead or past ⇒
 * CLOSED — the flag defaults OFF, and closes itself when the date passes.
 */
export function plaintextReadsOpen(env: Pick<Env, 'PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL'>, nowMs: number): boolean {
  const raw = env.PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return false;
  const until = Date.parse(`${raw.trim()}T00:00:00Z`);
  if (!Number.isFinite(until)) return false;
  return nowMs < until && until - nowMs <= PLAINTEXT_WINDOW_MAX_DAYS * 86_400_000;
}

/** What a (subject, provider) read found. `unreadable` is a refusal, never a guess. */
export type StoredToken =
  | { kind: 'none' }
  | { kind: 'token'; token: string; clientId: string | null }
  | { kind: 'unreadable'; why: string };

/**
 * The stored refresh token for a (subject, provider), decrypted.
 *
 * `unreadable` when the row cannot be turned into a token without guessing: a
 * key that is absent, malformed or wrong, a ciphertext that fails
 * authentication, or a row still in plain text once the window has closed.
 */
export async function storedProviderToken(
  env: TokenStoreEnv,
  subjectRef: string,
  provider: ProviderName,
  nowMs: number = Date.now(),
): Promise<StoredToken> {
  const open = plaintextReadsOpen(env, nowMs);
  // Closed, the plain-text column is not even selected: the ciphertext is the ONLY read.
  const statement = open
    ? env.PLATFORM_DB.prepare('SELECT token_ct, token_key_id, client_id, refresh_token FROM provider_tokens WHERE subject_ref = ? AND provider = ?')
    : env.PLATFORM_DB.prepare('SELECT token_ct, token_key_id, client_id FROM provider_tokens WHERE subject_ref = ? AND provider = ?');
  const row = await statement
    .bind(subjectRef, provider)
    .first<{ token_ct: string | null; token_key_id: string | null; client_id: string | null; refresh_token?: string }>();
  if (row === null) return { kind: 'none' };
  const clientId = typeof row.client_id === 'string' && row.client_id !== '' ? row.client_id : null;
  // Plain text is present only in a row no Worker of this version wrote — one
  // stored before 0023, or by the old Worker in the deploy window — so it is
  // the newest value the row holds.
  if (open && typeof row.refresh_token === 'string' && row.refresh_token !== '') {
    return { kind: 'token', token: row.refresh_token, clientId };
  }
  if (row.token_ct === null || row.token_key_id === null) {
    return {
      kind: 'unreadable',
      why: open
        ? `the stored ${provider} token row holds no token`
        : `the stored ${provider} token is not encrypted yet and the plain-text read window is closed`,
    };
  }
  const key = await tokenKey(env, row.token_key_id);
  if ('refused' in key) return { kind: 'unreadable', why: key.refused };
  const token = await decryptToken(key.key, row.token_key_id, { subjectRef, provider }, row.token_ct);
  if (token === null) {
    return { kind: 'unreadable', why: `the stored ${provider} token does not decrypt under key ${row.token_key_id} (wrong key, or the row was altered)` };
  }
  return { kind: 'token', token, clientId };
}

/**
 * Keep (or replace) the token this subject's last sign-in with `provider`
 * produced, ENCRYPTED. `appId` is the provenance marker the monitor attributes
 * the row by.
 *
 * ⏱ 2026-10-02 · review of #1155, finding 1 (migration 0024). `clientId` is
 * the OAuth client the token was ISSUED TO, when that is not the Worker's
 * `APPLE_REVOKE_CLIENT_ID`: an Apple token from the native sheet belongs to
 * the app's bundle id, and Apple revokes a token only for its own client.
 * Null — every web and Google token — revokes as it always has.
 *
 * 🔴 THROWS rather than store plain text when the current key cannot be used:
 * the route answers 503 and nothing is written.
 */
export async function putProviderToken(
  env: TokenStoreEnv,
  subjectRef: string,
  provider: ProviderName,
  appId: string,
  refreshToken: string,
  nowIso: string,
  clientId: string | null = null,
): Promise<void> {
  const key = await tokenKey(env, CURRENT_TOKEN_KEY_ID);
  if ('refused' in key) throw new Error(`refusing to store a ${provider} token: ${key.refused}`);
  const sealed = await encryptToken(key.key, CURRENT_TOKEN_KEY_ID, { subjectRef, provider }, refreshToken);
  // `refresh_token` is written as the literal '' on both branches — never bound.
  // `client_id` is replaced on every write: a web sign-in after a native one
  // holds the web client's token, and must not keep the native client's name.
  await env.PLATFORM_DB.prepare(
    `INSERT INTO provider_tokens (subject_ref, provider, app_id, refresh_token, token_ct, token_key_id, client_id, stored_at)
       VALUES (?,?,?,'',?,?,?,?)
       ON CONFLICT (subject_ref, provider) DO UPDATE SET
         app_id = excluded.app_id,
         refresh_token = '',
         token_ct = excluded.token_ct,
         token_key_id = excluded.token_key_id,
         client_id = excluded.client_id,
         stored_at = excluded.stored_at`,
  )
    .bind(subjectRef, provider, appId, sealed, CURRENT_TOKEN_KEY_ID, clientId, nowIso)
    .run();
}

/** One heartbeat row of the backfill. */
export interface TokenBackfillOutcome {
  target: string;
  ok: boolean;
  detail: string;
}

/**
 * THE BACKFILL: encrypt every token row still holding plain text, and empty the
 * retired 0012 table's copies. Run by the nightly `provider_token_backfill`
 * limb (src/scheduled.ts); returns its one heartbeat row and never throws.
 *
 *   · IDEMPOTENT: each step selects only rows still holding plain text, and the
 *     seal is conditional on the value read — a second run changes no row.
 *   · RESUMABLE: at most MAX_TOKEN_BACKFILL_PER_RUN rows a run; the rest wait for
 *     the next night, and the row says how many.
 *   · ONLY INSIDE THE WINDOW. Closed, it reads nothing of `refresh_token`: it
 *     counts the rows with no ciphertext, which is red when any exist (such a
 *     row can no longer be read at all).
 *   · 🔴 NO KEY ⇒ NOTHING IS TOUCHED, and the row is red naming the secret.
 *
 * The 0012 rows are copied (0016's own conflict-safe statement, which 0016 says
 * must re-run before that table goes) BEFORE they are emptied, and a row is
 * emptied only when `provider_tokens` holds that subject's Apple row.
 */
export async function backfillProviderTokens(env: TokenStoreEnv, nowMs: number = Date.now()): Promise<TokenBackfillOutcome> {
  const target = 'provider_tokens';
  try {
    const key = await tokenKey(env, CURRENT_TOKEN_KEY_ID);
    if ('refused' in key) {
      return { target, ok: false, detail: `REFUSED, nothing touched: ${key.refused}` };
    }
    if (!plaintextReadsOpen(env, nowMs)) {
      // Counted WITHOUT naming the plain-text column.
      const n = await env.PLATFORM_DB.prepare('SELECT COUNT(*) AS unsealed FROM provider_tokens WHERE token_ct IS NULL').first<{
        unsealed: number;
      }>();
      const unsealed = Number(n?.unsealed ?? 0);
      return {
        target,
        ok: unsealed === 0,
        detail: unsealed === 0
          ? 'plain-text window closed; every token row is sealed'
          : `plain-text window closed with ${unsealed} row(s) never sealed — they can no longer be read, so their revokes are blocked`,
      };
    }
    // 0016's conflict-safe copy of the retired 0012 rows, re-run BEFORE they are emptied…
    const copied = (
      await env.PLATFORM_DB.prepare(
        `INSERT INTO provider_tokens (subject_ref, provider, app_id, refresh_token, stored_at)
       SELECT subject_ref, 'apple', app_id, refresh_token, stored_at FROM apple_provider_tokens WHERE refresh_token <> ''
       ON CONFLICT (subject_ref, provider) DO NOTHING`,
      ).run()
    ).meta.changes;
    // …and a 0012 row is emptied only once provider_tokens holds that subject's Apple row.
    const emptied = (
      await env.PLATFORM_DB.prepare(
        `UPDATE apple_provider_tokens SET refresh_token = '' WHERE refresh_token <> ''
       AND EXISTS (SELECT 1 FROM provider_tokens p WHERE p.subject_ref = apple_provider_tokens.subject_ref AND p.provider = 'apple')`,
      ).run()
    ).meta.changes;
    const due = await env.PLATFORM_DB.prepare(
      `SELECT subject_ref, provider, refresh_token FROM provider_tokens WHERE refresh_token <> '' ORDER BY subject_ref, provider LIMIT ?`,
    )
      .bind(MAX_TOKEN_BACKFILL_PER_RUN)
      .all<{ subject_ref: string; provider: string; refresh_token: string }>();
    let sealed = 0;
    let raced = 0;
    for (const row of due.results ?? []) {
      const ct = await encryptToken(key.key, CURRENT_TOKEN_KEY_ID, { subjectRef: row.subject_ref, provider: row.provider }, row.refresh_token);
      // Sealed only if the row still holds exactly the value read: a concurrent
      // write is never overwritten, and a second run matches nothing.
      const res = await env.PLATFORM_DB.prepare(
        `UPDATE provider_tokens SET token_ct = ?, token_key_id = ?, refresh_token = ''
       WHERE subject_ref = ? AND provider = ? AND refresh_token = ?`,
      )
        .bind(ct, CURRENT_TOKEN_KEY_ID, row.subject_ref, row.provider, row.refresh_token)
        .run();
      if (res.meta.changes === 1) sealed++;
      else raced++;
    }
    const left = await env.PLATFORM_DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM provider_tokens WHERE refresh_token <> '') AS live,
         (SELECT COUNT(*) FROM apple_provider_tokens WHERE refresh_token <> '') AS legacy,
         (SELECT COUNT(*) FROM provider_tokens WHERE token_ct IS NULL) AS unsealed`,
    ).first<{ live: number; legacy: number; unsealed: number }>();
    const live = Number(left?.live ?? 0);
    const legacy = Number(left?.legacy ?? 0);
    const unsealed = Number(left?.unsealed ?? 0);
    return {
      target,
      ok: live === 0 && legacy === 0 && unsealed === 0,
      detail:
        `sealed=${sealed} raced=${raced} copied_0012=${copied} emptied_0012=${emptied} ` +
        `plaintext_left=${live} plaintext_left_0012=${legacy} unsealed=${unsealed} window_until=${env.PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL}`,
    };
  } catch (err) {
    return { target, ok: false, detail: `backfill FAILED: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Forget one provider's token — after its revoke settled. */
export async function dropProviderToken(db: D1Database, subjectRef: string, provider: ProviderName): Promise<void> {
  await db.prepare('DELETE FROM provider_tokens WHERE subject_ref = ? AND provider = ?').bind(subjectRef, provider).run();
}

/**
 * Forget every provider's token for a subject — when the erasure is over.
 *
 * ⚠️ AND THE SUBJECT'S ROW IN THE RETIRED 0012 TABLE, the one statement that
 * DELETES from `apple_provider_tokens`. 0016 COPIED its rows rather than moving
 * them, so without this an erased account's copy — its subject id, and until the
 * ⏱ 2026-09-30 backfill empties it a token already revoked through the
 * `provider_tokens` copy — would outlive the erasure until the later migration
 * drops the table. That migration removes this line.
 */
export async function dropProviderTokens(db: D1Database, subjectRef: string): Promise<void> {
  await db.prepare('DELETE FROM provider_tokens WHERE subject_ref = ?').bind(subjectRef).run();
  await db.prepare('DELETE FROM apple_provider_tokens WHERE subject_ref = ?').bind(subjectRef).run();
}

/**
 * The stored token, or the outcome a failed read has to be: `transient` when the
 * database did not answer, and 🔴 `blocked` when the row cannot be decrypted —
 * no key, the wrong key, an altered row, or plain text past the window. That is
 * the fail-closed direction: the deletion stays pending and the log names why,
 * and nothing is revoked with, or falls back to, a value nobody authenticated.
 */
async function readToken(
  env: Env,
  subjectRef: string,
  provider: ProviderName,
  rid: string,
): Promise<{ token: string | null; clientId: string | null } | { failed: RevokeOutcome }> {
  let stored: StoredToken;
  try {
    stored = await storedProviderToken(env, subjectRef, provider);
  } catch (err) {
    return { failed: { kind: 'transient', why: `${provider} token read failed: ${err instanceof Error ? err.message : 'unknown'}` } };
  }
  if (stored.kind === 'none') return { token: null, clientId: null };
  if (stored.kind === 'unreadable') {
    console.error(`[${provider}-revoke] rid=${rid} REFUSING to revoke: ${stored.why}. The deletion stays pending and is retried; it is NOT reported as done.`);
    return { failed: { kind: 'blocked', why: `stored token unreadable: ${stored.why}` } };
  }
  return { token: stored.token, clientId: stored.clientId };
}

/** Forget the token once its provider has settled it, or say why that failed. */
async function settleRevoke(
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
  const read = await readToken(env, subjectRef, 'apple', rid);
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

  // The client the token was issued to: the bundle id for a native-sheet
  // token (⏱ 2026-10-02, migration 0024), the web Services ID otherwise. A
  // secret minted for the wrong client is refused by Apple as `invalid_client`.
  const client: AppleRevokeCredentials = { ...creds.ok, clientId: read.clientId ?? creds.ok.clientId };
  let secret: string;
  try {
    secret = await appleClientSecret(client, Math.floor(Date.now() / 1000));
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
        client_id: client.clientId,
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
    const settled = await settleRevoke(env, subjectRef, 'apple', rid, { kind: 'revoked' });
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

/** Apple's token endpoint: where an authorization code is exchanged. */
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';

/**
 * The OAuth client a NATIVE Sign in with Apple sheet issues its code to: the
 * app's bundle id, `com.nikatru.<appId>` — the same derivation the app's
 * widget, entitlements and provisioning use (`com.nikatru.${AppConfig.appId}`).
 */
export function appleNativeClientId(appId: string): string {
  return `com.nikatru.${appId}`;
}

/** What one code exchange did. A token only on `ok`; it is never logged. */
export type AppleCodeExchange =
  | { kind: 'ok'; refreshToken: string; clientId: string }
  | { kind: 'refused'; why: string }
  | { kind: 'blocked'; why: string }
  | { kind: 'transient'; why: string };

/**
 * ⏱ 2026-10-02 · review of #1155, finding 1 — THE NATIVE SHEET'S HALF OF
 * O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE.
 *
 * The browser door ends in a session GoTrue hands a `provider_refresh_token`;
 * the native sheet ends in `signInWithIdToken`, which carries none. What the
 * sheet DOES return is a one-time `authorizationCode`, valid for five minutes,
 * and Apple's token endpoint turns it into the refresh token a deletion
 * revokes with. That exchange needs the Sign in with Apple key, which only
 * this Worker holds — so the app posts the code here and never the token.
 *
 * Same four owner-provisioned values as the revoke; the client is the app's
 * bundle id, minted into the client secret's `sub`.
 */
export async function exchangeAppleAuthorizationCode(env: Env, appId: string, code: string): Promise<AppleCodeExchange> {
  const creds = appleRevokeCredentials(env);
  if ('missing' in creds) return { kind: 'blocked', why: `missing ${creds.missing.join(',')}` };
  const client: AppleRevokeCredentials = { ...creds.ok, clientId: appleNativeClientId(appId) };
  let secret: string;
  try {
    secret = await appleClientSecret(client, Math.floor(Date.now() / 1000));
  } catch {
    return { kind: 'blocked', why: 'client secret could not be minted' };
  }
  let res: Response;
  try {
    res = await fetch(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: secret,
        code,
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(PROVIDER_REVOKE_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: 'transient', why: `apple unreachable: ${err instanceof Error ? err.message : 'unknown'}` };
  }
  if (!res.ok) {
    // `invalid_grant` (a used, expired or foreign code) and `invalid_client`
    // are refusals a retry cannot change; 429 and 5xx can.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      return { kind: 'refused', why: `apple answered ${res.status}` };
    }
    return { kind: 'transient', why: `apple answered ${res.status}` };
  }
  const body = (await res.json().catch(() => null)) as { refresh_token?: unknown } | null;
  const refreshToken = body?.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken.trim().length < 8) {
    return { kind: 'refused', why: 'apple answered 200 with no refresh token' };
  }
  return { kind: 'ok', refreshToken: refreshToken.trim(), clientId: client.clientId };
}

/**
 * Revoke this subject's Google token, and forget it once Google has settled it.
 *
 * Needs no Worker secret: the request carries the token and nothing else.
 * `rid` only ever reaches a log line; the token never does.
 */
export async function revokeGoogleToken(env: Env, subjectRef: string, rid: string): Promise<RevokeOutcome> {
  const read = await readToken(env, subjectRef, 'google', rid);
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
    const settled = await settleRevoke(env, subjectRef, 'google', rid, { kind: 'revoked' });
    if (settled.kind === 'revoked') console.log(`[google-revoke] rid=${rid} revoked 1 Google token`);
    return settled;
  }

  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    // Already revoked or expired: the grant this token stood for is gone, so
    // there is nothing to revoke and nothing to retry. The row goes with it.
    if (body?.error === 'invalid_token') {
      const settled = await settleRevoke(env, subjectRef, 'google', rid, { kind: 'none' });
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
