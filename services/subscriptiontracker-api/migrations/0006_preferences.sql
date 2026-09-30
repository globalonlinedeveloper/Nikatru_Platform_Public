-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_preferences.sql — the account's preferences, ONE ROW PER KEY (audit D11,
-- label ST-N6: "preferences follow the account", the API half).
-- Applies to APP_DB (subscriptiontracker_db):
--   wrangler d1 migrations apply APP_DB --local   (or --remote)
--
-- Currency, theme, language and the reminder choices lived only in each
-- device's key-value store, so a second device started from the defaults and a
-- change on one never reached the other.
--
-- ⏱ 2026-09-30 · lead ruling on #1080: PER KEY, SERVER-ORDERED, NEVER THE
-- WHOLE DOCUMENT. The first draft stored one JSON document replaced whole, so a
-- stale device overwrote keys it never touched. Here each key is its own row
-- with a `version` only the SERVER bumps; a PATCH names the version its change
-- was based on, and a newer server version is a conflict the server wins
-- (src/routes/preferences.ts). `updated_at` is server time, never the client's.
--
-- Numbered 0006 because #1063's 0005_lifecycle_history_categories.sql lands
-- first. STRICTLY ADDITIVE: one new table (tooling/ci/check-migrations.mjs).
-- `user_id` makes every row user-owned BY DEFINITION, so src/routes/account.ts's
-- derived erasure deletes them with the account.
--
-- DEPLOY ORDER api → web IS REQUIRED, and it is safe: this file is applied
-- before the Worker that names the table, and a web build that lands first
-- gets a 404, which the client treats as "try later" and keeps its changes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS preferences (
  user_id     TEXT NOT NULL,
  -- A key from the route's closed set (or `switch.<name>`).
  key         TEXT NOT NULL,
  -- The value, JSON. The route checks its type and range per key.
  value       TEXT NOT NULL,
  -- Bumped by the server on every accepted write; 1 for the first.
  version     INTEGER NOT NULL,
  -- Server time of the last accepted write.
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
