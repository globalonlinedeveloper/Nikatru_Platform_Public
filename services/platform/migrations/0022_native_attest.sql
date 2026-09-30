-- ─────────────────────────────────────────────────────────────────────────────
-- 0022_native_attest.sql — THE NATIVE SIGN-IN ATTESTATION STATE: redeemed
-- challenge nonces, the key each app install registered, and two daily counters
-- (⏱ 2026-09-29, ADR no.NNN "native sign-in serves only attested app installs";
-- ⏱ 2026-09-30 reshaped before its first apply, on the independent review of
-- #1070: challenges are STATELESS, so issuing one writes no row at all).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- src/lib/native-attest/index.ts reads and writes all three; the route is
-- src/routes/native-auth.ts.
--
--   native_attest_redeemed — the nonce of every challenge a request has
--                            presented, with the challenge's expiry. A challenge
--                            itself is an HMAC-signed token and is never stored;
--                            THIS row is what makes it single-use. Every
--                            redemption deletes the expired rows first, so the
--                            table holds at most one TTL's worth of redemptions.
--   native_attest_keys     — one row per registered install key: an App Attest
--                            key (its attested P-256 public key and the assertion
--                            counter) or a desktop install's Ed25519 public key. A
--                            PUBLIC key and a counter — no account, no email, no
--                            device identifier.
--   native_attest_counters — one row per (UTC day, scope): today's Play Integrity
--                            decodes (the ceiling below Google's quota) and today's
--                            key registrations per network (`install:edge:<colo>:<asn>`
--                            — a Cloudflare PoP and an autonomous-system number,
--                            never an address). Every bump deletes the previous
--                            days' rows first.
--
-- 🔴 NO `user_id` AND NO `install_id`, ON PURPOSE. Nothing here is linked to the
-- account that later signs in, so the erasure walk has nothing to find; and
-- `install_id` is the pseudonymity firewall's reserved analytics-id name
-- (tooling/ci/assert-pseudonymity-firewall.mjs) — `key_id` is a hash of a public
-- key, not a pseudonym.
--
-- 🔴 EVERY TIMESTAMP IS ISO-8601 TEXT, NEVER INTEGER MILLISECONDS — the nightly
-- `retentionSweep` binds an ISO cutoff (same convention and reason as 0013/0017).
--
-- ⚠️ NO CHECK CONSTRAINTS, as everywhere in this directory: `kind` and `scope`
-- are closed sets enforced in src/lib/native-attest/index.ts.
--
-- REPLAY: CREATE TABLE / CREATE INDEX IF NOT EXISTS only, so the file re-applies
-- cleanly and is listed in REPLAY_SAFE_MIGRATIONS (test/harness.ts).
--
-- RETENTION (scheduled.ts `retentionSweep`, besides the inline pruning above): a
-- redeemed nonce is swept once expired, IN FULL (no per-run row cap); a counter
-- row once its day is past, in full; a key when unused for
-- NATIVE_ATTEST_KEYS_RETENTION_DAYS — the app then answers
-- `attestation_key_unknown` once and registers a fresh key.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS native_attest_redeemed (
  nonce      TEXT PRIMARY KEY NOT NULL,
  app_id     TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Every redemption and the nightly sweep delete by this.
CREATE INDEX IF NOT EXISTS idx_native_attest_redeemed_expires ON native_attest_redeemed (expires_at);

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

-- Registration's inline pruning and the nightly sweep read this.
CREATE INDEX IF NOT EXISTS idx_native_attest_keys_last_used ON native_attest_keys (last_used_at);

CREATE TABLE IF NOT EXISTS native_attest_counters (
  day   TEXT NOT NULL,
  scope TEXT NOT NULL,
  calls INTEGER NOT NULL,
  PRIMARY KEY (day, scope)
);
