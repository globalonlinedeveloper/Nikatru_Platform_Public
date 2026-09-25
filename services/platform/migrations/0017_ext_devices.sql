-- ─────────────────────────────────────────────────────────────────────────────
-- 0017_ext_devices.sql — THE BROWSER EXTENSION'S ACCOUNT CHECK: a one-time code
-- and the per-device credential it is exchanged for (O-EXTENSION-ACCOUNT-CHECK-UNBUILT).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- ADR 059 D10 names one route the extension calls — GET /v1/entitlements — and
-- D7 sets revocation per session. A Supabase session is the wrong thing to hand
-- an extension (it refreshes, it carries email, it opens every account route),
-- so the account is linked ONCE, on https://nikatru.com/ext/connect, and the
-- extension is given a credential that can do exactly two things: read FullShot's
-- entitlement and revoke itself (routes/ext.ts, middleware/ext-device-auth.ts).
--
--   ext_codes    — a 120-second, single-use code minted by the signed-in page
--                  and exchanged by the extension (PKCE S256, exact redirect_uri).
--                  Only SHA-256(code) is stored.
--   ext_devices  — one row per linked browser. Only SHA-256(token) is stored;
--                  the token itself is returned ONCE and never written anywhere.
--
-- 🔴 EVERY TIMESTAMP IS ISO-8601 TEXT, NEVER INTEGER MILLISECONDS. The nightly
-- `retentionSweep` binds an ISO string (`retentionCutoff`, scheduled.ts), and
-- SQLite sorts EVERY INTEGER BELOW EVERY TEXT — an integer `expires_at` would make
-- the sweep's `expires_at < ?` true for every row, live codes included, and the
-- exchange's `expires_at > ?` false for every row. Same convention as 0013.
--
-- 🔴 `user_id`, SPELT EXACTLY, IS A DECISION (as in 0013): the erasure walk
-- DELETES every row of a table carrying a `user_id` column
-- (services/_shared/src/erasure.ts), so erasing the account removes every code
-- and every linked device with it.
--
-- 🔴 `link_id`, NOT `device_id` — the design's name. tooling/ci/assert-pseudonymity-firewall.mjs
-- reserves `device_id` / `install_id` / `anon_id` for PSEUDONYMOUS identifiers and
-- refuses one beside `user_id` ([ADR 020]:21). This id is not a pseudonym: it is a
-- server-minted UUID naming ONE browser's link to an account, created from that
-- account and erased with it. Spelling it `device_id` would have put an account
-- key under the name the firewall reads as an analytics id; renaming it keeps
-- the firewall whole instead of exempting three files from it.
--
-- ⚠️ NO CHECK CONSTRAINTS, as everywhere in this directory: `product` and
-- `channel` are closed sets enforced in routes/ext.ts.
--
-- REPLAY: CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only, so the file
-- re-applies cleanly and is listed in REPLAY_SAFE_MIGRATIONS (test/harness.ts).
--
-- RETENTION: `ext_codes` is swept 24 h after `expires_at` by `retentionSweep`
-- (EXT_CODES_RETENTION_DAYS). `ext_devices` is kept while the account exists: a
-- row is a live credential until it is revoked or the account is erased.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ext_codes (
  code_hash      TEXT PRIMARY KEY NOT NULL,
  user_id        TEXT NOT NULL,
  product        TEXT NOT NULL,
  channel        TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  used_at        TEXT
);

-- The retention sweep reads this, nightly.
CREATE INDEX IF NOT EXISTS idx_ext_codes_expires ON ext_codes (expires_at);

CREATE TABLE IF NOT EXISTS ext_devices (
  link_id      TEXT PRIMARY KEY NOT NULL,
  user_id      TEXT NOT NULL,
  product      TEXT NOT NULL,
  channel      TEXT NOT NULL,
  token_hash   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at   TEXT
);

-- Every device-authenticated request looks its credential up by this, and a
-- token hash names exactly one device.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_devices_token_hash ON ext_devices (token_hash);
-- The erasure walk deletes by user_id.
CREATE INDEX IF NOT EXISTS idx_ext_devices_user ON ext_devices (user_id);
