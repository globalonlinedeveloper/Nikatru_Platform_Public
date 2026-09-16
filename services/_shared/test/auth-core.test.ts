import { describe, it, expect } from 'vitest';
import {
  JWKS_KV_KEY,
  JWKS_TTL_SECONDS,
  bearer,
  isKeySetUnavailable,
  usableJwksDocument,
  verifyOptions,
  CLOCK_SKEW_SECONDS,
  REAUTH_REQUIRED_BODY,
  REAUTH_REQUIRED_STATUS,
  RECENT_AUTH_SECONDS,
  authRecencyOf,
  deletionRecencyRefusal,
} from '../src/auth';

// ─────────────────────────────────────────────────────────────────────────────
// The auth decisions every Worker makes the same way, tested ONCE — and, because
// `services/_shared/test/**` is in both Workers' `vitest.config.ts` include, run
// in BOTH lanes (`worker-platform` and `worker-subscriptiontracker-api` in ci.yml). That is
// the point: before [ADR 067] decision 2 these declarations existed three times
// and each carrier's suite could only ever have tested its own copy.
//
// 🔴 THE CASES BELOW ARE THE RECORDED CORRECTIONS, NOT INVENTED INPUTS. Two of
// `isKeySetUnavailable`'s branches exist because the first version of that
// predicate was measured wrong in both directions (see the long block on it in
// src/auth.ts): too narrow to fire in production, and simultaneously wide enough
// to serve a token signed by a ROTATED-OUT key out of a stale cache.
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyOptions — the ES256 pin (INV-406)', () => {
  it('pins the algorithm, so the TOKEN never decides how it is verified', () => {
    expect(verifyOptions('https://id.example').algorithms).toEqual(['ES256']);
  });

  it('binds issuer and audience to the identity project it was given', () => {
    const opts = verifyOptions('https://id.example');
    expect(opts.issuer).toBe('https://id.example/auth/v1');
    expect(opts.audience).toBe('authenticated');
  });

  it('is one object per call, so a caller cannot mutate the pin for everyone', () => {
    const a = verifyOptions('https://id.example');
    (a.algorithms as string[]).push('HS256');
    expect(verifyOptions('https://id.example').algorithms).toEqual(['ES256']);
  });
});

describe('bearer — the Authorization header parse', () => {
  it('takes the token after `Bearer `', () => {
    expect(bearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme, as RFC 7235 requires', () => {
    expect(bearer('bearer abc')).toBe('abc');
    expect(bearer('BEARER abc')).toBe('abc');
  });

  it('takes everything after the first run of whitespace', () => {
    expect(bearer('Bearer   abc')).toBe('abc');
  });

  it('is null for a header with a scheme and NOTHING after it', () => {
    // The one case worth stating: `(.+)` does not match the empty tail, so a
    // caller who sent a scheme and no credential gets the same answer as one who
    // sent no header at all — a 401, not an attempt to verify the empty string.
    expect(bearer('Bearer')).toBeNull();
    expect(bearer('Bearer ')).toBeNull();
  });

  it('is null for another scheme, and for no header at all', () => {
    expect(bearer('Basic dXNlcjpwYXNz')).toBeNull();
    expect(bearer('')).toBeNull();
  });
});

describe('isKeySetUnavailable — "could not get the keys" vs "the token is bad"', () => {
  const withCode = (code: string): Error => Object.assign(new Error('x'), { code });

  it('is TRUE for jose\'s own JWKS fetch timeout', () => {
    expect(isKeySetUnavailable(withCode('ERR_JWKS_TIMEOUT'))).toBe(true);
  });

  it('is TRUE for a bare JOSEError — the NON-200 shape a dead tunnel produces', () => {
    // Measured: `new JOSEError(` appears exactly twice in the installed browser
    // dist, both in runtime/fetch_jwks.js. Box A is reached through a Cloudflare
    // Tunnel, and a tunnel with no origin answers 502/530 — which jose turns
    // into exactly this. The first version of the predicate missed it.
    expect(isKeySetUnavailable(withCode('ERR_JOSE_GENERIC'))).toBe(true);
  });

  it('is TRUE for an error carrying no jose code — the runtime fetch failing', () => {
    expect(isKeySetUnavailable(new TypeError('fetch failed'))).toBe(true);
    expect(isKeySetUnavailable(withCode('ECONNREFUSED'))).toBe(true);
  });

  it('is FALSE for a `kid` that is not in the key set — that is a fact about the TOKEN', () => {
    // 🔴 THE SECURITY CASE. Accepting this would give a token a second bite at
    // verification against an OLDER key set, so a token signed by a key that had
    // since been ROTATED OUT would be admitted from the cache.
    expect(isKeySetUnavailable(withCode('ERR_JWKS_NO_MATCHING_KEY'))).toBe(false);
    expect(isKeySetUnavailable(withCode('ERR_JWKS_MULTIPLE_MATCHING_KEYS'))).toBe(false);
  });

  it('is FALSE for a signature that did not verify, and for every other jose code', () => {
    expect(isKeySetUnavailable(withCode('ERR_JWS_SIGNATURE_VERIFICATION_FAILED'))).toBe(false);
    expect(isKeySetUnavailable(withCode('ERR_JWT_EXPIRED'))).toBe(false);
    // A FUTURE jose class arrives WITH a code and is excluded by the last
    // clause, rather than swept into the fallback by a "not a JWT error"
    // negative test — the property the rejected negative test could not offer.
    expect(isKeySetUnavailable(withCode('ERR_SOMETHING_JOSE_ADDS_LATER'))).toBe(false);
  });

  it('is FALSE for a thrown non-Error, which is not evidence of anything', () => {
    expect(isKeySetUnavailable('boom')).toBe(false);
    expect(isKeySetUnavailable(undefined)).toBe(false);
  });
});

describe('usableJwksDocument — an EMPTY key set is not a usable fallback', () => {
  it('returns the document when it carries at least one key', () => {
    expect(usableJwksDocument('{"keys":[{"kty":"EC"}]}')).toEqual({ keys: [{ kty: 'EC' }] });
  });

  it('is null for an EMPTY key set — what a misconfigured GoTrue publishes', () => {
    // Treating it as usable would turn a configuration error into a silent,
    // permanent 401 nobody could diagnose.
    expect(usableJwksDocument('{"keys":[]}')).toBeNull();
  });

  it('is null when there is no `keys` array at all', () => {
    expect(usableJwksDocument('{}')).toBeNull();
    expect(usableJwksDocument('{"keys":{}}')).toBeNull();
  });

  it('is null for an unparseable cache, and for no cache', () => {
    expect(usableJwksDocument('<html>502</html>')).toBeNull();
    expect(usableJwksDocument(null)).toBeNull();
  });
});

describe('the KV constants', () => {
  it('name one key, because there is one identity project portfolio-wide', () => {
    expect(JWKS_KV_KEY).toBe('supabase_jwks');
  });

  it('spends ~14% of the Free daily KV write budget, as the derivation states', () => {
    // 86400 / TTL writes per day against `kv.writesPerDay` = 1000. The assertion
    // is the ARITHMETIC in the comment, not the literal: a change to the
    // constant that breaks the reasoning fails here.
    expect(86400 / JWKS_TTL_SECONDS).toBeLessThan(1000 * 0.2);
    expect(JWKS_TTL_SECONDS).toBeGreaterThan(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-16 · O-APP-API-DELETE-NO-RECENCY — the recent-sign-in rule every
// erasure door reads. Run in BOTH Worker lanes and in the stamped-Worker lane, so
// the rule is tested once and cannot be tested against a copy.
// ─────────────────────────────────────────────────────────────────────────────
describe('deletionRecencyRefusal — the recent-sign-in rule for account deletion', () => {
  const NOW = 1_800_000_000;
  const apple = (lastAuthenticatedAt: number | null) => ({ passwordless: true, lastAuthenticatedAt });

  it('a FRESH password-less sign-in proceeds', () => {
    expect(deletionRecencyRefusal(apple(NOW - 30), NOW)).toBeNull();
    expect(deletionRecencyRefusal(apple(NOW - RECENT_AUTH_SECONDS), NOW)).toBeNull();
  });

  it('🔴 a STALE password-less sign-in is refused', () => {
    expect(deletionRecencyRefusal(apple(NOW - RECENT_AUTH_SECONDS - 1), NOW)).toMatch(/without a sign-in/);
  });

  it('🔴 a password-less token with NO amr timestamp is refused', () => {
    expect(deletionRecencyRefusal(apple(null), NOW)).toMatch(/no amr timestamp/);
  });

  it('🔴 a timestamp beyond the skew allowance in the FUTURE is refused; within it proceeds', () => {
    expect(deletionRecencyRefusal(apple(NOW + CLOCK_SKEW_SECONDS + 1), NOW)).toMatch(/in the future/);
    expect(deletionRecencyRefusal(apple(NOW + CLOCK_SKEW_SECONDS), NOW)).toBeNull();
  });

  it('a PASSWORD account is not held to it, however old its sign-in (the recorded decision)', () => {
    expect(deletionRecencyRefusal({ passwordless: false, lastAuthenticatedAt: NOW - 5 * 3600 }, NOW)).toBeNull();
    expect(deletionRecencyRefusal({ passwordless: false, lastAuthenticatedAt: null }, NOW)).toBeNull();
  });

  it('🔴 NO recency at all (the middleware did not set it) is a refusal, not a pass', () => {
    expect(deletionRecencyRefusal(undefined, NOW)).toMatch(/did not set it/);
  });

  it('the window is ten minutes and the skew one', () => {
    expect(RECENT_AUTH_SECONDS).toBe(600);
    expect(CLOCK_SKEW_SECONDS).toBe(60);
  });

  it('🔴 the refusal is 403 reauth_required — never 401, which the client reads as a dead session', () => {
    expect(REAUTH_REQUIRED_STATUS).toBe(403);
    expect(REAUTH_REQUIRED_BODY).toEqual({ error: 'reauth_required' });
  });
});

describe('authRecencyOf — WHEN the person last authenticated, from `amr`', () => {
  it('reads only a POSITIVE password-less claim, and the newest amr entry', () => {
    expect(authRecencyOf({})).toEqual({ passwordless: false, lastAuthenticatedAt: null });
    expect(authRecencyOf({ app_metadata: { providers: 'apple' } }).passwordless).toBe(false);
    expect(authRecencyOf({ app_metadata: { providers: ['apple'] } }).passwordless).toBe(true);
    expect(authRecencyOf({ app_metadata: { providers: ['email', 'apple'] } }).passwordless).toBe(false);
    expect(
      authRecencyOf({ amr: [{ method: 'oauth', timestamp: 100 }, { method: 'otp', timestamp: 250 }, { timestamp: 'x' }] })
        .lastAuthenticatedAt,
    ).toBe(250);
  });

  it('🔴 a brand-new `iat` does NOT stand in for a sign-in — a refreshed session stays stale', () => {
    const now = 1_800_000_000;
    const refreshed = authRecencyOf({
      iat: now,
      app_metadata: { providers: ['apple'] },
      amr: [{ method: 'oauth', timestamp: now - 7200 }],
    });
    expect(refreshed.lastAuthenticatedAt).toBe(now - 7200);
    expect(deletionRecencyRefusal(refreshed, now)).not.toBeNull();
    // And a token carrying only `iat` has no authentication time at all.
    expect(authRecencyOf({ iat: now, app_metadata: { providers: ['apple'] } }).lastAuthenticatedAt).toBeNull();
  });
});
