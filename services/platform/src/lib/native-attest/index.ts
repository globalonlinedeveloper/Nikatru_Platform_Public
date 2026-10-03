// ─────────────────────────────────────────────────────────────────────────────
// native-attest — WHO may use the captcha-free native sign-in route
// (⏱ 2026-09-29, ADR no.NNN "native sign-in serves only attested app installs";
// ⏱ 2026-09-30 revised on the independent review of #1070, LEAD RULING db0cc7).
//
// 🔴 THE DEFECT THIS CLOSES. routes/native-auth.ts forwards the password grant,
// /signup, /recover and /resend to GoTrue with the service-role bearer, which
// skips GoTrue's Turnstile captcha. Until this module, the only test that a
// caller was an app was a MISSING `Origin` header — any script could send the
// request and get captcha-free sign-in and sign-up, bounded by rate limits alone.
//
// Every op now carries an ATTESTATION bound to a single-use server challenge, to
// the request's path and query, and to the exact body (wire protocol v2; the
// client half is packages/core native_attest.dart + packages/auth_supabase):
//
//   clientData = "nk-native-auth/v2\n<app>\n<op>\n<challenge>\n<target>\n<b64url SHA-256(body)>"
//   target     = <path>[?<every query pair, decoded, sorted by key then value,
//                 each encodeURIComponent(k)=encodeURIComponent(v), joined by &>]
//
//   kind            proof                                         who verifies
//   play-integrity  Play Integrity verdict, nonce = SHA-256(cD)   Google signs, decrypted, verified and graded HERE
//   app-attest      App Attest assertion over SHA-256(cD)         Apple's chain, verified HERE
//   install-key     Ed25519 signature by a per-install key        NOBODY vouches for the binary
//
// 🔴 `install-key` PROVES NOTHING A SCRIPT CANNOT DO (review finding 1). A script
// mints a key and registers it exactly as a desktop build would. So:
//   · it is NOT listed in NATIVE_AUTH_ATTEST_KINDS in any deploy (wrangler.jsonc);
//   · and even when listed, KIND_OPS lets it authorise ONLY the password grant
//     (and its own key registration) — never signup, recover or resend. Desktop
//     sign-up and reset go through the web Turnstile flow. A desktop channel is
//     served only after desktop BINARY attestation exists (the PR's row).
//
// CHALLENGES ARE STATELESS (review finding 2). Issuing one writes nothing: it is
// an HMAC-SHA256 token over (app, expiry, nonce) under NATIVE_ATTEST_CHALLENGE_KEY.
// Only a REDEEMED nonce is written (native_attest_redeemed), which is what makes
// it single-use, and every redemption first deletes the expired ones — so the
// table holds at most the nonces redeemed in the last NATIVE_ATTEST_CHALLENGE_TTL_SECONDS.
//
// FAIL CLOSED, EVERYWHERE: a kind not in NATIVE_AUTH_ATTEST_KINDS is 403; a kind
// asked to authorise an op KIND_OPS does not give it is 403; a listed kind whose
// server config is missing is 503; a challenge is burned by the first request
// that presents it, pass or fail.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb, SqlResult, SqlStatement } from '../../../../_shared/src/ports/sql';
import type { Env } from '../../types';
import { b64url, fromB64, fromB64url, sha256 } from './bytes';
import { appleRootDer, verifyAssertion, verifyAttestation } from './app-attest';
import { parsePlayKeys, pinsFor, plausibleIntegrityToken, verifyPlayIntegrity } from './play-integrity';

export const ATTEST_KINDS = ['play-integrity', 'app-attest', 'install-key'] as const;
export type AttestKind = (typeof ATTEST_KINDS)[number];

export type AttestOp = 'token' | 'signup' | 'recover' | 'resend' | 'install';

/**
 * THE OP TABLE: which calls each kind may authorise. Structural, not config —
 * no value of NATIVE_AUTH_ATTEST_KINDS lets `install-key` reach signup, recover
 * or resend. `play-integrity` registers no key, so it has no `install`.
 */
export const KIND_OPS: Readonly<Record<AttestKind, ReadonlySet<AttestOp>>> = {
  'play-integrity': new Set<AttestOp>(['token', 'signup', 'recover', 'resend']),
  'app-attest': new Set<AttestOp>(['token', 'signup', 'recover', 'resend', 'install']),
  'install-key': new Set<AttestOp>(['token', 'install']),
};

export const BINDING_PREFIX = 'nk-native-auth/v2';

/**
 * How long an issued challenge stays redeemable.
 *
 * @ceiling none — a FRESHNESS bound on a single-use input, not a platform
 * resource: long enough for a Play Integrity or App Attest round trip on a slow
 * phone, short enough that a harvested challenge is worthless.
 */
export const NATIVE_ATTEST_CHALLENGE_TTL_SECONDS = 120;

// ⏱ 2026-10-03 (O-PLAY-INTEGRITY-LOCAL-VERIFY): PLAY_INTEGRITY_DAILY_CEILING and
// PLAY_INTEGRITY_DAILY_PER_NETWORK are gone with the Google decode they rationed.
// A Play proof is now decrypted and verified in this Worker, so it spends no
// shared quota, and a daily counter bumped BEFORE verification was itself the
// switch one script could flip to turn Android sign-in off for everyone. The
// burst bound that remains is NATIVE_AUTH_PLAY_VERIFY_LIMITER (per network).

/**
 * Native sign-in calls ONE registered key (one app install) may authorise per
 * UTC day, for the key kinds (`app-attest`, `install-key`). ⏱ 2026-09-30
 * (second review of #1070, nit 9): a hooked or jailbroken device holds a genuine
 * key and could otherwise sign unlimited calls; a person signs in a few times a
 * day, so fifty is room for every retry and still a bound.
 *
 * @ceiling none — a per-install USAGE bound, not a platform resource.
 */
export const NATIVE_ATTEST_OPS_PER_KEY_PER_DAY = 50;

/**
 * Key registrations one network (`edge:<colo>:<asn>`) may write per UTC day.
 *
 * @ceiling none — a WRITE bound on an unauthenticated route into platform_db,
 * not a platform limit: an install registers once, so a network registering
 * more than this in a day is minting keys, not installing an app.
 */
export const NATIVE_ATTEST_INSTALLS_PER_NETWORK_PER_DAY = 100;

export const HEADER = {
  kind: 'x-nk-attest-kind',
  challenge: 'x-nk-attest-challenge',
  key: 'x-nk-attest-key',
  proof: 'x-nk-attest-proof',
} as const;

/** The request's path and canonical query — the part of the URL every proof covers. */
export function requestTarget(url: URL): string {
  const pairs = [...url.searchParams].sort(([ka, va], [kb, vb]) => (ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0));
  if (pairs.length === 0) return url.pathname;
  return `${url.pathname}?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

/** The binding every proof covers. */
export async function clientDataFor(app: string, op: AttestOp, challenge: string, target: string, body: Uint8Array): Promise<string> {
  return [BINDING_PREFIX, app, op, challenge, target, b64url(await sha256(body))].join('\n');
}

/** The kinds this deploy accepts: NATIVE_AUTH_ATTEST_KINDS, comma-separated. Absent ⇒ none. */
export function enabledKinds(env: Pick<Env, 'NATIVE_AUTH_ATTEST_KINDS'>): Set<AttestKind> {
  const listed = (env.NATIVE_AUTH_ATTEST_KINDS ?? '').split(',').map((s) => s.trim());
  return new Set(ATTEST_KINDS.filter((k) => listed.includes(k)));
}

/** The challenge-signing secret, when it is long enough to be one. */
const challengeSecret = (env: Pick<Env, 'NATIVE_ATTEST_CHALLENGE_KEY'>) =>
  typeof env.NATIVE_ATTEST_CHALLENGE_KEY === 'string' && env.NATIVE_ATTEST_CHALLENGE_KEY.length >= 32 ? env.NATIVE_ATTEST_CHALLENGE_KEY : null;

/** Whether the server can mint and redeem challenges at all. */
export const challengesConfigured = (env: Env): boolean => !!env.PLATFORM_DB && challengeSecret(env) !== null;

/** Whether the server holds what `kind` needs to verify anything for `app`. */
export function configured(env: Env, kind: AttestKind, app: string): boolean {
  if (!challengesConfigured(env)) return false;
  if (kind === 'play-integrity') {
    return (
      parsePlayKeys(env.PLAY_INTEGRITY_DECRYPTION_KEY, env.PLAY_INTEGRITY_VERIFICATION_KEY) !== null &&
      pinsFor(env.PLAY_INTEGRITY_CERT_DIGESTS, app) !== null
    );
  }
  if (kind === 'app-attest') return typeof env.APP_ATTEST_TEAM_ID === 'string' && /^[A-Z0-9]{10}$/.test(env.APP_ATTEST_TEAM_ID);
  return true;
}

/** `c1.<app>.<expiry, unix seconds>.<nonce, 16 bytes>.<HMAC-SHA256, 32 bytes>`. */
const CHALLENGE = /^c1\.([a-z][a-z0-9]{0,39})\.(\d{10})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

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

/**
 * Statements in every D1 batch this module sends: one prune, then one write.
 *
 * @ceiling none — a FIXED shape, not a data-sized count: a request sends at
 * most three such batches (redeem, daily counter, key write) and two single
 * reads, far under d1.queriesPerInvocation (tooling/ceilings.json batchCallSites
 * names this constant as the bound).
 */
export const NATIVE_ATTEST_BATCH_STATEMENTS = 2;

/** The one batch shape: prune what has expired, then write — atomically. Answers the write's result. */
async function pruneThenWrite<T = unknown>(db: SqlDb, prune: SqlStatement, write: SqlStatement): Promise<SqlResult<T> | undefined> {
  const statements: [SqlStatement, SqlStatement] = [prune, write];
  const results = (await db.batch(statements)) as SqlResult<T>[];
  return results[NATIVE_ATTEST_BATCH_STATEMENTS - 1];
}

let hmacKey: { secret: string; key: Promise<CryptoKey> } | null = null;
function macKey(secret: string): Promise<CryptoKey> {
  if (hmacKey?.secret !== secret) {
    hmacKey = {
      secret,
      key: crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
    };
  }
  return hmacKey.key;
}

/** Mints a challenge. STATELESS: nothing is written — the MAC is what makes it the server's. */
export async function issueChallenge(env: Env, app: string, now: number): Promise<string> {
  const secret = challengeSecret(env);
  if (!secret) throw new Error('NATIVE_ATTEST_CHALLENGE_KEY is not set');
  const exp = Math.floor(now / 1000) + NATIVE_ATTEST_CHALLENGE_TTL_SECONDS;
  const body = `c1.${app}.${exp}.${b64url(crypto.getRandomValues(new Uint8Array(16)))}`;
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await macKey(secret), new TextEncoder().encode(body)));
  return `${body}.${b64url(mac)}`;
}

/**
 * Whether `challenge` is one THIS server minted for `app` and has not expired:
 * the shape, the app, the expiry window and the MAC. PURE — no D1 — so the route
 * runs it before any limiter is spent (second review of #1070, nit 8): a forged
 * challenge must not cost a network its Play or install budget.
 */
export async function challengeIsOurs(env: Env, app: string, challenge: string, now: number): Promise<boolean> {
  const secret = challengeSecret(env);
  const m = CHALLENGE.exec(challenge);
  if (!secret || !m) return false;
  const [, forApp, expRaw, , macRaw] = m;
  const exp = Number(expRaw) * 1000;
  if (forApp !== app || exp <= now || exp > now + (NATIVE_ATTEST_CHALLENGE_TTL_SECONDS + 60) * 1000) return false;
  const mac = fromB64url(macRaw!);
  if (!mac) return false;
  const body = challenge.slice(0, challenge.length - macRaw!.length - 1);
  return crypto.subtle.verify('HMAC', await macKey(secret), mac, new TextEncoder().encode(body));
}

/**
 * Redeems a challenge: its MAC is this server's, it names this app, it has not
 * expired — and its nonce has never been redeemed. The nonce is then written
 * (with its expiry) so a replay finds it; every redemption first deletes the
 * expired ones, so the table is bounded by what was redeemed inside one TTL.
 * True exactly once per challenge.
 */
export async function redeemChallenge(env: Env, app: string, challenge: string, now: number): Promise<boolean> {
  if (!(await challengeIsOurs(env, app, challenge, now))) return false;
  const [, , expRaw, nonce] = CHALLENGE.exec(challenge)!;
  return redeemNonce(env, app, nonce!, Number(expRaw) * 1000, now);
}

/**
 * Writes a single-use `nonce` (expiring at `expMs`) into native_attest_redeemed,
 * first deleting the expired ones. True exactly once per nonce. ⏱ 2026-10-01:
 * shared by challenges and by the system-browser hand-off codes (handoff.ts) —
 * both nonces are 16 random bytes, so the two never collide.
 */
export async function redeemNonce(env: Env, app: string, nonce: string, expMs: number, now: number): Promise<boolean> {
  const inserted = await pruneThenWrite(
    env.PLATFORM_DB,
    env.PLATFORM_DB.prepare('DELETE FROM native_attest_redeemed WHERE expires_at < ?').bind(iso(now)),
    env.PLATFORM_DB.prepare(
      'INSERT INTO native_attest_redeemed (nonce, app_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(nonce) DO NOTHING',
    ).bind(nonce, app, iso(expMs)),
  );
  return inserted?.meta.changes === 1;
}

/**
 * ⏱ 2026-10-02 — gives a redeemed nonce BACK, for the one caller that spends it
 * before the work it pays for: the hand-off exchange (routes/native-auth.ts), when
 * GoTrue fails after the code was redeemed (review of #1133, finding 3). Without
 * it a transient 5xx burned the code and the app's retry read "used". Only after
 * a fault that minted no session; a race still has exactly one winner, because
 * the loser was refused before this runs. Throws nothing: a failed delete leaves
 * the code spent, which is the behaviour before.
 */
export async function releaseNonce(env: Env, app: string, nonce: string): Promise<void> {
  try {
    await env.PLATFORM_DB.prepare('DELETE FROM native_attest_redeemed WHERE nonce = ? AND app_id = ?').bind(nonce, app).run();
  } catch {
    // the code stays spent
  }
}

/**
 * Adds one to today's counter for `scope` and answers the new total. Every call
 * first deletes the previous days' rows, so the table holds one UTC day.
 */
export async function bumpDailyCounter(db: SqlDb, scope: string, now: number): Promise<number> {
  const day = iso(now).slice(0, 10);
  const bumped = await pruneThenWrite<{ calls: number }>(
    db,
    db.prepare('DELETE FROM native_attest_counters WHERE day < ?').bind(day),
    db
      .prepare(
        'INSERT INTO native_attest_counters (day, scope, calls) VALUES (?, ?, 1) ON CONFLICT(day, scope) DO UPDATE SET calls = calls + 1 RETURNING calls',
      )
      .bind(day, scope),
  );
  const calls = bumped?.results?.[0]?.calls;
  return typeof calls === 'number' ? calls : Number.POSITIVE_INFINITY;
}

interface KeyRow {
  kind: string;
  public_key: string;
  sign_count: number;
}

export type Outcome =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 401 | 429 | 503;
      code: 'attestation_invalid' | 'attestation_key_unknown' | 'native_auth_unavailable' | 'over_request_rate_limit';
      why: string;
    };

const invalid = (why: string): Outcome => ({ ok: false, status: 401, code: 'attestation_invalid', why });
const malformed = (why: string): Outcome => ({ ok: false, status: 400, code: 'attestation_invalid', why });
const unavailable = (why: string): Outcome => ({ ok: false, status: 503, code: 'native_auth_unavailable', why });
const overBudget = (why: string): Outcome => ({ ok: false, status: 429, code: 'over_request_rate_limit', why });

/** Whether a Play Integrity proof is worth spending anything on (see plausibleIntegrityToken). */
export const playProofPlausible = (h: AttestHeaders): boolean => plausibleIntegrityToken(h.proof);

/** The App ID App Attest binds: `<TEAM ID>.com.nikatru.<app>`. */
const appleAppId = (env: Env, app: string) => `${env.APP_ATTEST_TEAM_ID}.com.nikatru.${app}`;

/**
 * Verifies an op's proof. The challenge has already been redeemed. `network` is
 * the caller's `edge:<colo>:<asn>` (lib/edge-ceiling.ts); no kind's verification
 * spends a per-network budget today (key registration's is in registerKey).
 */
export async function verifyOp(
  env: Env,
  app: string,
  kind: AttestKind,
  h: AttestHeaders,
  clientData: string,
  network: string,
  now: number,
): Promise<Outcome> {
  const db = env.PLATFORM_DB;
  if (kind === 'play-integrity') {
    const keys = parsePlayKeys(env.PLAY_INTEGRITY_DECRYPTION_KEY, env.PLAY_INTEGRITY_VERIFICATION_KEY);
    const pins = pinsFor(env.PLAY_INTEGRITY_CERT_DIGESTS, app);
    if (!keys || !pins) return unavailable('play-integrity unconfigured');
    // Decrypted, verified and graded HERE (O-PLAY-INTEGRITY-LOCAL-VERIFY): no
    // Google call and no shared daily counter, so no caller can spend another's
    // sign-in. A token that does not decrypt or verify is refused, never 503.
    if (!plausibleIntegrityToken(h.proof)) return malformed('token shape');
    const v = await verifyPlayIntegrity(h.proof, `com.nikatru.${app}`, b64url(await sha256(clientData)), keys, pins, now);
    return v.ok ? { ok: true } : invalid(v.why);
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
    if (cas.meta.changes !== 1) return invalid('counter raced');
    return withinKeyBudget(db, app, h.key, now);
  }

  // install-key (KIND_OPS has already confined it to the password grant)
  if (!(await ed25519Verify(publicKey, proof, clientData))) return invalid('signature');
  await db.prepare('UPDATE native_attest_keys SET last_used_at = ? WHERE app_id = ? AND key_id = ?').bind(iso(now), app, h.key).run();
  return withinKeyBudget(db, app, h.key, now);
}

/** A VERIFIED key's daily budget (NATIVE_ATTEST_OPS_PER_KEY_PER_DAY), counted only once its proof has passed. */
async function withinKeyBudget(db: SqlDb, app: string, keyId: string, now: number): Promise<Outcome> {
  return (await bumpDailyCounter(db, `key:${app}:${keyId}`, now)) > NATIVE_ATTEST_OPS_PER_KEY_PER_DAY
    ? overBudget('daily calls for this key')
    : { ok: true };
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

/**
 * Days a registered key may go unused before a registration write prunes it.
 *
 * @ceiling none — a RETENTION PERIOD, the same number as scheduled.ts
 * NATIVE_ATTEST_KEYS_RETENTION_DAYS (test/native-auth.test.ts holds them equal).
 */
export const NATIVE_ATTEST_KEY_IDLE_DAYS = 90;

export type InstallOutcome =
  | { ok: true; keyId: string; created: boolean }
  | Exclude<Outcome, { ok: true }>
  | { ok: false; status: 400; code: 'validation_failed'; why: string }
  | { ok: false; status: 429; code: 'over_request_rate_limit'; why: string };

/**
 * Registers an install's key. The body names the key; the proof is the
 * attestation (app-attest) or a signature by the key itself (install-key,
 * proof of possession). The challenge has already been redeemed. The write is
 * held to NATIVE_ATTEST_INSTALLS_PER_NETWORK_PER_DAY for `network`, and prunes
 * long-idle keys before it inserts.
 */
export async function registerKey(
  env: Env,
  app: string,
  kind: 'app-attest' | 'install-key',
  body: Record<string, unknown>,
  h: AttestHeaders,
  clientData: string,
  network: string,
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

  if ((await bumpDailyCounter(env.PLATFORM_DB, `install:${network}`, now)) > NATIVE_ATTEST_INSTALLS_PER_NETWORK_PER_DAY) {
    return { ok: false, status: 429, code: 'over_request_rate_limit', why: 'daily registrations for this network' };
  }
  const ins = await pruneThenWrite(
    env.PLATFORM_DB,
    env.PLATFORM_DB.prepare(
      'DELETE FROM native_attest_keys WHERE rowid IN (SELECT rowid FROM native_attest_keys WHERE last_used_at < ? ORDER BY last_used_at LIMIT 100)',
    ).bind(iso(now - NATIVE_ATTEST_KEY_IDLE_DAYS * 86_400_000)),
    env.PLATFORM_DB.prepare(
      'INSERT INTO native_attest_keys (app_id, key_id, kind, public_key, sign_count, created_at, last_used_at) VALUES (?, ?, ?, ?, 0, ?, ?) ON CONFLICT(app_id, key_id) DO NOTHING',
    ).bind(app, keyId, kind, b64url(publicKey), iso(now), iso(now)),
  );
  return { ok: true, keyId, created: ins?.meta.changes === 1 };
}
