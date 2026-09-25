-- ─────────────────────────────────────────────────────────────────────────────
-- 0016_provider_tokens.sql — ONE ROW PER (SUBJECT, PROVIDER): THE APPLE-ONLY
-- TOKEN TABLE BECOMES A PROVIDER TABLE (row O-GOOGLE-SIGN-IN-NOT-BUILT, the
-- server half).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- WHY. Deleting an account must cut the app's grant at EVERY identity provider
-- it signed in through, not only at Apple. Google's revoke endpoint
-- (`POST https://oauth2.googleapis.com/revoke`, form field `token`) takes the
-- token and nothing else, so the only thing the deletion is missing is the same
-- one 0012 records for Apple: Supabase hands `provider_refresh_token` to the
-- CLIENT once and stores none of it. This table holds it per provider.
--
-- The column rules are 0012's, unchanged, and for 0012's reasons:
--   · 🔴 NO `user_id` COLUMN. The erasure walk (services/_shared/src/erasure.ts)
--     deletes every row of every table with a `user_id` column, which would
--     destroy the token MID-DELETION, before the revoke the deletion exists to
--     perform. The subject is `subject_ref`; the revoke path deletes the row.
--   · `app_id` IS THE PROVENANCE MARKER — the app whose sign-in produced the
--     token, resolved against the shipped catalogue by the production monitor.
--   · IT HOLDS A LIVE CREDENTIAL. Nothing logs it, no route reads it back, and the
--     only reader is services/platform/src/lib/provider-revoke.ts.
--   · RETENTION: while the account exists; deleted when the provider answers the
--     revoke, or when the erasure is over.
--
-- `provider` is CHECKed against the two providers the revoke path knows. A row
-- for any other provider would be a credential nothing can ever revoke, so the
-- database refuses it rather than trusting the route alone.
--
-- ── THE COPY, AND WHY `apple_provider_tokens` IS NOT DROPPED HERE ────────────
-- Every existing Apple row is copied in with `provider = 'apple'`. The old table
-- STAYS in this migration: dropping it is a separate, later change, made only
-- after this copy has been read back in production. From this migration on, no
-- code reads or writes it; the one statement that still names it deletes an
-- ERASED subject's row (provider-revoke.ts `dropProviderTokens`), because a copy is
-- not a move and the old row would otherwise outlive the erasure.
--   ⚠️ The deploy applies this file BEFORE the new Worker is live, so a token the
--   OLD Worker stores in that window lands only in the old table. The later drop
--   must re-run the copy below first; it is conflict-safe, so running it twice
--   moves only the rows the first run missed.
--
-- REPLAY. Both statements are replay-safe forms test/migrations-replay.test.ts
-- classifies: CREATE TABLE IF NOT EXISTS, and an INSERT whose conflict clause is
-- DO NOTHING. `WHERE true` is not decoration: SQLite cannot otherwise tell an
-- upsert's ON CONFLICT from a join constraint after `INSERT … SELECT … FROM t`
-- (sqlite.org/lang_upsert.html, "Parsing Ambiguity").
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS provider_tokens (
  subject_ref   TEXT NOT NULL,
  provider      TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  app_id        TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  stored_at     TEXT NOT NULL,
  PRIMARY KEY (subject_ref, provider)
);

INSERT INTO provider_tokens (subject_ref, provider, app_id, refresh_token, stored_at)
SELECT subject_ref, 'apple', app_id, refresh_token, stored_at
  FROM apple_provider_tokens
 WHERE true
ON CONFLICT (subject_ref, provider) DO NOTHING;
