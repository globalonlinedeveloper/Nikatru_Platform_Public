import { describe, it, expect } from 'vitest';
import {
  CLOCK_SKEW_SECONDS,
  REVOCATION_TTL_SECONDS,
  pruneRevocation,
  revocationKey,
  revocationRefusal,
  withRevokedBefore,
  withRevokedSessions,
} from '../src/auth';

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS — the revocation decision every auth
// middleware reads, tested ONCE and run in every Worker lane (both
// `vitest.config.ts` include `../_shared/test/**`, and so does the stamped one).
// ─────────────────────────────────────────────────────────────────────────────

const NOW = 1_800_000_000;
const SID = '6f1c0b2e-8a4d-4c1e-9b7a-2d3e4f5a6b7c';
const OTHER = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';

describe('revocationRefusal — is this verified token from a signed-out session?', () => {
  it('🔴 a token whose session_id is listed is refused', () => {
    expect(revocationRefusal({ session_id: SID, iat: NOW }, { before: null, sids: [[SID, NOW - 5]] })).toBe(
      'session_revoked',
    );
  });

  it('a token from a DIFFERENT session of the same user is admitted', () => {
    expect(revocationRefusal({ session_id: OTHER, iat: NOW }, { before: null, sids: [[SID, NOW - 5]] })).toBeNull();
  });

  it('🔴 a token issued before `before` is refused', () => {
    expect(revocationRefusal({ session_id: SID, iat: NOW - 1 }, { before: NOW, sids: [] })).toBe(
      'issued_before_revoke',
    );
  });

  it('a token issued AT or AFTER `before` is admitted', () => {
    expect(revocationRefusal({ session_id: SID, iat: NOW }, { before: NOW, sids: [] })).toBeNull();
    expect(revocationRefusal({ session_id: SID, iat: NOW + 1 }, { before: NOW, sids: [] })).toBeNull();
  });

  it('🔴 `before` set and the token carries no usable iat is refused — it cannot prove it is newer', () => {
    expect(revocationRefusal({ session_id: SID }, { before: NOW, sids: [] })).toBe('issued_before_revoke');
    expect(revocationRefusal({ session_id: SID, iat: 'x' }, { before: NOW, sids: [] })).toBe('issued_before_revoke');
    expect(revocationRefusal({ session_id: SID, iat: Number.NaN }, { before: NOW, sids: [] })).toBe(
      'issued_before_revoke',
    );
  });

  it('no record at all admits', () => {
    expect(revocationRefusal({ session_id: SID, iat: NOW }, null)).toBeNull();
  });

  it('a MALFORMED record admits, entry by entry — a corruption is not a refusal', () => {
    const p = { session_id: SID, iat: NOW };
    expect(revocationRefusal(p, 'x')).toBeNull();
    expect(revocationRefusal(p, [[SID, NOW]])).toBeNull();
    expect(revocationRefusal(p, { sids: 'x' })).toBeNull();
    expect(revocationRefusal(p, { sids: [[1, 2]] })).toBeNull();
    expect(revocationRefusal(p, { sids: [[SID]] })).toBeNull();
    expect(revocationRefusal(p, { sids: [[SID, 'yesterday']] })).toBeNull();
    expect(revocationRefusal(p, { before: 'x', sids: [] })).toBeNull();
    // A malformed entry is SKIPPED, not fatal: a well-formed one after it still refuses.
    expect(revocationRefusal(p, { sids: [[1, 2], 'x', [SID, NOW]] })).toBe('session_revoked');
  });

  it('a token with no session_id is outside the sids limb, and `before` still applies', () => {
    expect(revocationRefusal({ iat: NOW }, { before: null, sids: [[SID, NOW]] })).toBeNull();
    expect(revocationRefusal({ iat: NOW - 1 }, { before: NOW, sids: [[SID, NOW]] })).toBe('issued_before_revoke');
  });
});

describe('pruneRevocation — nothing is kept that can no longer refuse a live token', () => {
  it('drops a sid revoked exactly REVOCATION_TTL_SECONDS ago, keeps one a second younger', () => {
    const out = pruneRevocation(
      { before: null, sids: [[SID, NOW - REVOCATION_TTL_SECONDS], [OTHER, NOW - REVOCATION_TTL_SECONDS + 1]] },
      NOW,
    );
    expect(out.sids).toEqual([[OTHER, NOW - REVOCATION_TTL_SECONDS + 1]]);
  });

  it('nulls a `before` at the horizon, keeps one inside it', () => {
    expect(pruneRevocation({ before: NOW - REVOCATION_TTL_SECONDS, sids: [] }, NOW).before).toBeNull();
    expect(pruneRevocation({ before: NOW - REVOCATION_TTL_SECONDS + 1, sids: [] }, NOW).before).toBe(
      NOW - REVOCATION_TTL_SECONDS + 1,
    );
  });

  it('comes out well-formed from any input, so a writer never re-puts a corruption', () => {
    expect(pruneRevocation(null, NOW)).toEqual({ before: null, sids: [] });
    expect(pruneRevocation('x', NOW)).toEqual({ before: null, sids: [] });
    expect(pruneRevocation({ before: 'x', sids: [[1, 2], [SID, NOW, 'extra'], [SID, NOW]] }, NOW)).toEqual({
      before: null,
      sids: [[SID, NOW]],
    });
  });

  it('the TTL is jwt_exp (3600) plus the clock-skew allowance', () => {
    expect(REVOCATION_TTL_SECONDS).toBe(3600 + CLOCK_SKEW_SECONDS);
  });
});

describe('withRevokedSessions / withRevokedBefore — the only two writes', () => {
  it('appends the ids at `now`, re-dating one already listed rather than duplicating it', () => {
    const out = withRevokedSessions({ before: null, sids: [[SID, NOW - 100]] }, [SID, OTHER], NOW);
    expect(out.sids).toEqual([
      [SID, NOW],
      [OTHER, NOW],
    ]);
  });

  it('prunes while it writes, and ignores an id that is not a non-empty string', () => {
    const out = withRevokedSessions({ before: null, sids: [[OTHER, NOW - REVOCATION_TTL_SECONDS]] }, [SID, '', 7], NOW);
    expect(out).toEqual({ before: null, sids: [[SID, NOW]] });
  });

  it('withRevokedBefore sets `before` to now, and keeps a LATER existing value', () => {
    expect(withRevokedBefore(null, NOW)).toEqual({ before: NOW, sids: [] });
    expect(withRevokedBefore({ before: NOW + 30, sids: [] }, NOW).before).toBe(NOW + 30);
    expect(withRevokedBefore({ before: NOW - 30, sids: [[SID, NOW - 30]] }, NOW)).toEqual({
      before: NOW,
      sids: [[SID, NOW - 30]],
    });
  });

  it('what the writers produce, the reader refuses', () => {
    const rec = withRevokedSessions(null, [SID], NOW);
    expect(revocationRefusal({ session_id: SID, iat: NOW - 10 }, rec)).toBe('session_revoked');
    expect(revocationRefusal({ session_id: SID, iat: NOW - 10 }, withRevokedBefore(null, NOW))).toBe(
      'issued_before_revoke',
    );
  });

  it('keys the record by user id', () => {
    expect(revocationKey('user-a')).toBe('rev:user-a');
  });
});
