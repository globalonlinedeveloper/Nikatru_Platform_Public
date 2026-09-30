-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_preferences.sql — the account's preferences (audit D11, label ST-N6:
-- "preferences follow the account", the API half).
-- Applies to APP_DB (subscriptiontracker_db):
--   wrangler d1 migrations apply APP_DB --local   (or --remote)
--
-- Currency, theme, language and the reminder choices lived only in each
-- device's key-value store, so a second device started from the defaults and a
-- change on one never reached the other. One row per account holds the
-- document the app writes whole (src/routes/preferences.ts validates every key
-- before a write); the device store stays the cache first paint reads.
--
-- STRICTLY ADDITIVE: one new table, no DROP, RENAME or rebuild
-- (tooling/ci/check-migrations.mjs). `user_id` makes the row user-owned BY
-- DEFINITION, so src/routes/account.ts's derived erasure deletes it with the
-- account and no hand-kept table list has to remember it.
--
-- DEPLOY ORDER api → web IS REQUIRED, and it is safe: this file is applied
-- before the Worker that names the table, and a web build that lands first
-- gets a 404 from GET /v1/preferences, which the client reads as "could not
-- ask" and keeps the device's own copy.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS preferences (
  user_id     TEXT PRIMARY KEY,
  -- The whole document, JSON. The route bounds its keys, types and size.
  document    TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
