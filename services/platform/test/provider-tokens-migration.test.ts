// ─────────────────────────────────────────────────────────────────────────────
// provider-tokens-migration.test.ts — migrations/0016_provider_tokens.sql, run by
// the REAL SQL engine the harness wraps, against a database that already holds
// 0012 rows — which is the production database's state when 0016 is applied.
//
// WHAT IS BEING PROVEN:
//   · every `apple_provider_tokens` row appears in `provider_tokens` with
//     `provider = 'apple'` and its own subject, app and token — a copy that moved
//     nothing would leave every existing Apple account's deletion with nothing to
//     revoke, and would look exactly like a clean migration;
//   · applying the file a second time copies nothing twice;
//   · the CHECK refuses a provider the revoke path does not know, and the key is
//     (subject, provider).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import providerTokens0016 from '../migrations/0016_provider_tokens.sql?raw';
import { PLATFORM_MIGRATIONS, RealDb } from './harness';

/** platform_db as it stands the moment BEFORE 0016 is applied. */
function before0016(): RealDb {
  const earlier = PLATFORM_MIGRATIONS.filter((sql) => sql !== providerTokens0016);
  // COVERAGE: exactly one entry was removed, so the database really is "every
  // migration but 0016" and not "a set that silently lost something else".
  expect(earlier).toHaveLength(PLATFORM_MIGRATIONS.length - 1);
  return new RealDb(earlier);
}

const seedApple = (db: RealDb, subject: string, token: string) =>
  db.db
    .prepare('INSERT INTO apple_provider_tokens (subject_ref, app_id, refresh_token, stored_at) VALUES (?,?,?,?)')
    .run(subject, 'subscriptiontracker', token, '2026-09-22T10:00:00.000Z');

const copied = (db: RealDb) =>
  db
    .rows('SELECT subject_ref, provider, app_id, refresh_token, stored_at FROM provider_tokens ORDER BY subject_ref')
    .map((r) => ({ ...r }));

describe('0016 copies every Apple token into provider_tokens', () => {
  it('an apple_provider_tokens row appears in provider_tokens with provider = apple, unchanged', () => {
    const db = before0016();
    seedApple(db, 'user-1', 'apple-token-one');
    seedApple(db, 'user-2', 'apple-token-two');

    db.db.exec(providerTokens0016);

    expect(copied(db)).toEqual([
      {
        subject_ref: 'user-1',
        provider: 'apple',
        app_id: 'subscriptiontracker',
        refresh_token: 'apple-token-one',
        stored_at: '2026-09-22T10:00:00.000Z',
      },
      {
        subject_ref: 'user-2',
        provider: 'apple',
        app_id: 'subscriptiontracker',
        refresh_token: 'apple-token-two',
        stored_at: '2026-09-22T10:00:00.000Z',
      },
    ]);
    // The old table is copied FROM, not emptied: dropping it is a later change.
    expect(db.count('apple_provider_tokens')).toBe(2);
  });

  it('applied twice, the copy moves nothing twice', () => {
    const db = before0016();
    seedApple(db, 'user-1', 'apple-token-one');
    db.db.exec(providerTokens0016);
    db.db.exec(providerTokens0016);
    expect(db.count('provider_tokens')).toBe(1);
  });

  it('a row the new code already wrote is not overwritten by a later copy', () => {
    const db = before0016();
    seedApple(db, 'user-1', 'apple-token-old');
    db.db.exec(providerTokens0016);
    db.db
      .prepare("UPDATE provider_tokens SET refresh_token = 'apple-token-new' WHERE subject_ref = 'user-1'")
      .run();
    db.db.exec(providerTokens0016);
    expect(copied(db).map((r) => r.refresh_token)).toEqual(['apple-token-new']);
  });
});

describe('provider_tokens refuses what the revoke path cannot revoke', () => {
  it('the CHECK refuses provider = github', () => {
    const db = before0016();
    db.db.exec(providerTokens0016);
    expect(() =>
      db.db
        .prepare('INSERT INTO provider_tokens (subject_ref, provider, app_id, refresh_token, stored_at) VALUES (?,?,?,?,?)')
        .run('user-1', 'github', 'subscriptiontracker', 'gh-token', '2026-09-24T00:00:00.000Z'),
    ).toThrow(/CHECK constraint failed/);
    expect(db.count('provider_tokens')).toBe(0);
  });

  it('the key is (subject, provider): apple and google side by side, a second apple conflicts', () => {
    const db = before0016();
    db.db.exec(providerTokens0016);
    const insert = db.db.prepare(
      'INSERT INTO provider_tokens (subject_ref, provider, app_id, refresh_token, stored_at) VALUES (?,?,?,?,?)',
    );
    insert.run('user-1', 'apple', 'subscriptiontracker', 'a-token', '2026-09-24T00:00:00.000Z');
    insert.run('user-1', 'google', 'subscriptiontracker', 'g-token', '2026-09-24T00:00:00.000Z');
    expect(db.count('provider_tokens', 'subject_ref = ?', 'user-1')).toBe(2);
    expect(() => insert.run('user-1', 'apple', 'subscriptiontracker', 'a-token-2', '2026-09-24T00:00:00.000Z')).toThrow(
      /UNIQUE constraint failed/,
    );
  });
});
