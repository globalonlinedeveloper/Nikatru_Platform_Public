// ─────────────────────────────────────────────────────────────────────────────
// handoff.ts — THE SYSTEM-BROWSER HAND-OFF CODE, for the native targets that
// cannot attest (⏱ 2026-10-01, ADR draft `native-sign-in-per-target`, which
// amends ADR no.084; rows O-DESKTOP-EMAIL-SIGN-IN-HAS-NO-ATTESTED-PATH).
//
// 🔴 WHY THIS EXISTS. Windows, macOS and Linux builds have no Play Integrity and
// no App Attest, so lib/native-attest/index.ts gives them nothing the captcha-free
// route can accept (`install-key` proves nothing a script cannot do, and no deploy
// lists it). Their sign-in therefore happens IN THE SYSTEM BROWSER, on
// nikatru.com — and only a code comes back. (Which sign-in the page offers is
// the page's business: sites/nikatru/app/connect.html is Sign in with Apple
// today, because a static page may not load Turnstile; an email account goes
// through the web app's Turnstile-gated sign-in in the stacked follow-up.)
//
//   1. the app makes a PKCE pair and opens
//      https://nikatru.com/app/connect?app=<app>&redirect_uri=<r>&code_challenge=<c>&state=<s>;
//   2. the user signs in THERE and presses Continue; the page, holding a FRESH
//      web session (RECENT_AUTH_SECONDS), calls POST /v1/auth/handoff/<app>/code (routes/native-handoff.ts)
//      and navigates to the redirect the SERVER answered, with `nk_code` and `state`;
//   3. the app (OS deep link `com.nikatru.<app>://auth-callback?nk_auth=handoff`,
//      or an RFC 8252 §7.3 loopback `http://127.0.0.1:<port>/nk-auth-callback`)
//      sends {code, code_verifier, redirect_uri} to
//      POST /v1/auth/native/<app>/handoff/token, and gets a NEW session of its own.
//
// NO PASSWORD EVER REACHES THE NATIVE APP, and the web session is never shared:
// the exchange mints a separate GoTrue session for the same user.
//
// ── THE CODE (every rule has a red test in test/native-handoff.test.ts) ─────
//   · `h1.<iv, 12 bytes>.<AES-256-GCM ciphertext>`, both base64url. The key is
//     HKDF-SHA256 of NATIVE_ATTEST_CHALLENGE_KEY with its own info string, so it
//     is never the challenge HMAC key. ENCRYPTED, not only signed: the code rides
//     in a URL (browser history, an OS launch argument) and the user id it
//     carries is nobody's business there.
//   · It carries {app, user, expiry, nonce, code_challenge, SHA-256(redirect_uri)}.
//     STATELESS like a challenge: minting writes nothing.
//   · SHORT-LIVED: NATIVE_HANDOFF_CODE_TTL_SECONDS.
//   · PKCE-BOUND: S256 only, `plain` refused; the verifier is RFC 7636 §4.1.
//   · CLIENT-BOUND: the app in the path must be the app it was minted for, and
//     the redirect_uri must equal the minted one BYTE FOR BYTE.
//   · SINGLE-USE: its nonce is redeemed into native_attest_redeemed (the table
//     challenges already use, pruned by expiry) — AFTER the PKCE check, so only a
//     holder of the verifier can spend it, and exactly once. A GoTrue fault AFTER
//     that gives the nonce back (releaseNonce), so a retry is not "used".
//   · REVOCABLE: "sign out everywhere", or a revoke of the session that minted it,
//     refuses a code minted before it (⏱ 2026-10-02, review of #1133, finding 2).
//   · Every exchange failure answers the SAME body, so nothing tells expired from
//     reused from mismatched (routes/native-auth.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { revocationKey, revocationRefusal } from '../../../../_shared/src/auth';
import type { Env } from '../../types';
import { b64url, fromB64url, sha256 } from './bytes';
import { redeemNonce } from './index';

/**
 * How long a hand-off code stays exchangeable.
 *
 * @ceiling none — a CREDENTIAL LIFETIME we chose, not a platform resource: the
 * browser hands the code to the app in the same second it is minted; two minutes
 * is the extension code's lifetime (routes/ext.ts EXT_CODE_TTL_MS) for the same hop.
 */
export const NATIVE_HANDOFF_CODE_TTL_SECONDS = 120;

/**
 * The marker the deep-link return carries. Deliberately NOT an `AuthFlow` value
 * (packages/auth_supabase auth_redirect.dart), so `authArrivalOf` reads a
 * hand-off arrival as none of its business; core `handoffCodeOf` reads it.
 */
export const HANDOFF_MARKER = 'handoff';

/** RFC 7636 §4.1: 43-128 characters of [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~". */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
/** An S256 challenge is base64url(SHA-256(verifier)) without padding: 43 characters. */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^h1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{40,1024})$/;
const LOOPBACK = /^http:\/\/127\.0\.0\.1:([0-9]{4,5})\/nk-auth-callback$/;
const AAD = new TextEncoder().encode('nk-native-handoff/v1');

/**
 * The return addresses a hand-off may go to for `app` — EXACT strings, no
 * normalisation: the app's own deep link with the hand-off marker, or a
 * loopback port on 127.0.0.1 (RFC 8252 §7.3; never `localhost`, which a hosts
 * file can point elsewhere, §8.3).
 */
export function isHandoffRedirect(app: string, value: string): boolean {
  if (value === `com.nikatru.${app}://auth-callback?nk_auth=${HANDOFF_MARKER}`) return true;
  const m = LOOPBACK.exec(value);
  if (!m) return false;
  const port = Number(m[1]);
  return port >= 1024 && port <= 65535 && String(port) === m[1];
}

export const isS256Challenge = (v: unknown): v is string => typeof v === 'string' && S256_CHALLENGE.test(v);
export const isVerifier = (v: unknown): v is string => typeof v === 'string' && VERIFIER.test(v);

/** base64url(SHA-256(verifier)) — RFC 7636 §4.6 S256. */
export async function s256(verifier: string): Promise<string> {
  return b64url(await sha256(verifier));
}

let aesKey: { secret: string; key: Promise<CryptoKey> } | null = null;
/** The code key: HKDF of the challenge secret under its own info, so it is never the HMAC key. */
function codeKey(secret: string): Promise<CryptoKey> {
  if (aesKey?.secret !== secret) {
    aesKey = {
      secret,
      key: (async () => {
        const ikm = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('nk-native-handoff/v1 code key') },
          ikm,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        );
      })(),
    };
  }
  return aesKey.key;
}

const secretOf = (env: Pick<Env, 'NATIVE_ATTEST_CHALLENGE_KEY'>) =>
  typeof env.NATIVE_ATTEST_CHALLENGE_KEY === 'string' && env.NATIVE_ATTEST_CHALLENGE_KEY.length >= 32 ? env.NATIVE_ATTEST_CHALLENGE_KEY : null;

/** Whether this deploy can mint and exchange hand-off codes at all. */
export const handoffConfigured = (env: Env): boolean => !!env.PLATFORM_DB && secretOf(env) !== null;

interface Payload {
  a: string; // app
  u: string; // user id (GoTrue `sub`)
  e: number; // expiry, unix seconds
  n: string; // nonce, 16 bytes base64url
  c: string; // S256 code_challenge
  r: string; // base64url SHA-256(redirect_uri)
  s?: string; // the minting token's GoTrue `session_id`, when it carried one
}

/** Mints a code for `user` on `app`. STATELESS: nothing is written. */
export async function mintHandoffCode(
  env: Env,
  o: { app: string; user: string; sessionId?: string; redirectUri: string; codeChallenge: string; now: number },
): Promise<string> {
  const secret = secretOf(env);
  if (!secret) throw new Error('NATIVE_ATTEST_CHALLENGE_KEY is not set');
  const payload: Payload = {
    a: o.app,
    u: o.user,
    e: Math.floor(o.now / 1000) + NATIVE_HANDOFF_CODE_TTL_SECONDS,
    n: b64url(crypto.getRandomValues(new Uint8Array(16))),
    c: o.codeChallenge,
    r: b64url(await sha256(o.redirectUri)),
    ...(typeof o.sessionId === 'string' && o.sessionId !== '' ? { s: o.sessionId } : {}),
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await codeKey(secret), new TextEncoder().encode(JSON.stringify(payload))),
  );
  return `h1.${b64url(iv)}.${b64url(sealed)}`;
}

/** Opens a code this server sealed; null for anything else. Checks nothing about its content. */
async function openCode(env: Env, code: string): Promise<Payload | null> {
  const secret = secretOf(env);
  const m = CODE.exec(code);
  if (!secret || !m) return null;
  const iv = fromB64url(m[1]!);
  const sealed = fromB64url(m[2]!);
  if (!iv || iv.length !== 12 || !sealed) return null;
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await codeKey(secret), sealed);
  } catch {
    return null;
  }
  try {
    const p = JSON.parse(new TextDecoder().decode(plain)) as Partial<Payload>;
    if (typeof p.a !== 'string' || typeof p.u !== 'string' || typeof p.e !== 'number' || typeof p.n !== 'string') return null;
    if (typeof p.c !== 'string' || typeof p.r !== 'string') return null;
    if (p.s !== undefined && typeof p.s !== 'string') return null;
    return p as Payload;
  } catch {
    return null;
  }
}

/** Why an exchange was refused — for the log line only; the caller always answers one body. */
export type HandoffRefusal = 'shape' | 'not-ours' | 'other-client' | 'expired' | 'redirect' | 'pkce' | 'revoked' | 'used';

/**
 * ⏱ 2026-10-02 — WAS THE CODE'S USER SIGNED OUT AFTER IT WAS MINTED? (review of
 * #1133, finding 2: a code minted before "sign out everywhere" redeemed for up to
 * NATIVE_HANDOFF_CODE_TTL_SECONDS, into a session that sign-out never covered.)
 * It reads `rev:<user>` and asks the ONE decision every carrier asks
 * (_shared/src/auth.ts revocationRefusal), with the code's MINT time standing in
 * for `iat` and the minting session for `session_id`: a `before` later than the
 * mint, or the minting session listed in `sids`, refuses it.
 * Fails OPEN, as the carriers do (middleware/auth.ts sessionRevoked): an unbound
 * namespace or a failed read admits, and the worst case is the behaviour before.
 */
async function revokedSinceMint(env: Env, p: Payload): Promise<boolean> {
  const kv = env.SESSION_REVOKED;
  if (!kv) return false;
  let record: unknown;
  try {
    record = await kv.get(revocationKey(p.u), 'json');
  } catch {
    return false;
  }
  return revocationRefusal({ iat: p.e - NATIVE_HANDOFF_CODE_TTL_SECONDS, session_id: p.s }, record) !== null;
}

/**
 * Redeems a code, IN THIS ORDER: the shape, the seal, the app, the expiry, the
 * redirect (byte for byte), the PKCE verifier — all pure — then the revocation
 * record, and only then the nonce, which a second presentation finds. Answers the
 * user id and the spent nonce (the caller gives it back after a GoTrue fault, with
 * releaseNonce), or the refusal.
 */
export async function redeemHandoffCode(
  env: Env,
  o: { app: string; code: unknown; verifier: unknown; redirectUri: unknown; now: number },
): Promise<{ ok: true; user: string; nonce: string } | { ok: false; why: HandoffRefusal }> {
  if (typeof o.code !== 'string' || !isVerifier(o.verifier) || typeof o.redirectUri !== 'string') return { ok: false, why: 'shape' };
  const p = await openCode(env, o.code);
  if (!p) return { ok: false, why: 'not-ours' };
  if (p.a !== o.app) return { ok: false, why: 'other-client' };
  const exp = p.e * 1000;
  if (exp <= o.now || exp > o.now + (NATIVE_HANDOFF_CODE_TTL_SECONDS + 60) * 1000) return { ok: false, why: 'expired' };
  if (p.r !== b64url(await sha256(o.redirectUri))) return { ok: false, why: 'redirect' };
  if ((await s256(o.verifier)) !== p.c) return { ok: false, why: 'pkce' };
  if (await revokedSinceMint(env, p)) return { ok: false, why: 'revoked' };
  if (!(await redeemNonce(env, o.app, p.n, exp, o.now))) return { ok: false, why: 'used' };
  return { ok: true, user: p.u, nonce: p.n };
}
