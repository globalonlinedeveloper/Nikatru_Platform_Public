-- ─────────────────────────────────────────────────────────────────────────────
-- 0021_native_attest.sql — THE NATIVE SIGN-IN ATTESTATION STATE: single-use
-- challenges, and the key each app install registered (⏱ 2026-09-29,
-- ADR no.NNN "native sign-in serves only attested app installs").
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- src/lib/native-attest/index.ts reads and writes both tables; the route is
-- src/routes/native-auth.ts.
--
--   native_attest_challenges — a 120-second, single-use challenge the app binds
--                              its attestation to. Only SHA-256(challenge) is
--                              stored, and redeeming one DELETES it, so a
--                              replayed request finds nothing.
--   native_attest_keys       — one row per registered install key: an App Attest
--                              key (its attested P-256 public key and the
--                              assertion counter) or a desktop install's Ed25519
--                              public key. A PUBLIC key and a counter — no
--                              account, no email, no device identifier: the row
--                              says "some install of this app holds this key",
--                              and nothing ties it to a person.
--
-- 🔴 NO `user_id` AND NO `install_id`, ON PURPOSE. A key is registered before
-- anybody signs in and is never linked to the account that later signs in with
-- it, so there is nothing here for the erasure walk to find; and `install_id`
-- is the pseudonymity firewall's reserved analytics-id name
-- (tooling/ci/assert-pseudonymity-firewall.mjs) — `key_id` is a hash of a public
-- key, not a pseudonym.
--
-- 🔴 EVERY TIMESTAMP IS ISO-8601 TEXT, NEVER INTEGER MILLISECONDS — the nightly
-- `retentionSweep` binds an ISO cutoff (same convention and reason as 0013/0017).
--
-- ⚠️ NO CHECK CONSTRAINTS, as everywhere in this directory: `kind` is a closed
-- set enforced in src/lib/native-attest/index.ts.
--
-- REPLAY: CREATE TABLE / CREATE INDEX IF NOT EXISTS only, so the file re-applies
-- cleanly and is listed in REPLAY_SAFE_MIGRATIONS (test/harness.ts).
--
-- RETENTION (scheduled.ts `retentionSweep`): a challenge is swept a day after
-- `expires_at` (NATIVE_ATTEST_CHALLENGES_RETENTION_DAYS); a key is swept when
-- unused for NATIVE_ATTEST_KEYS_RETENTION_DAYS — the app then answers
-- `attestation_key_unknown` once and registers a fresh key.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS native_attest_challenges (
  challenge_hash TEXT PRIMARY KEY NOT NULL,
  app_id         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);

-- The retention sweep reads this, nightly.
CREATE INDEX IF NOT EXISTS idx_native_attest_challenges_expires ON native_attest_challenges (expires_at);

CREATE TABLE IF NOT EXISTS native_attest_keys (
  app_id       TEXT NOT NULL,
  key_id       TEXT NOT NULL,
  kind         TEXT NOT NULL,
  public_key   TEXT NOT NULL,
  sign_count   INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (app_id, key_id)
);

-- The retention sweep reads this, nightly.
CREATE INDEX IF NOT EXISTS idx_native_attest_keys_last_used ON native_attest_keys (last_used_at);
