-- ─────────────────────────────────────────────────────────────────────────────
-- 0005_lifecycle_history_categories.sql — the tables and columns the ST-E3
-- lifecycle, the ST-I4 price history and the ST-X8 category ids need
-- (round-2 findings F03 F04 B33 F14 F16 B29 C11; [ADR 077] §5.1 + §5.2).
-- Applies to APP_DB (subscriptiontracker_db):
--   wrangler d1 migrations apply APP_DB --local   (or --remote)
--
-- ⚠️ NUMBERED 0005 WITH NO 0004 ON main, ON PURPOSE. ST-T4b (#1058) claims
-- 0004_notice_days.sql and had not landed when this file was written; a landed
-- migration is never renumbered, so this one leaves the slot free. Wrangler
-- applies by name in order and records each name, so either landing order is
-- safe: neither file reads anything the other adds.
--
-- 🔴 THE LIFECYCLE ITSELF NEEDS NO DDL. `status`, `cancelled_on` and
-- `deleted_at` are 0003's; what kept them unusable was the route
-- (src/routes/subscriptions.ts `STATUSES_ACCEPTED` and the refused
-- `deleted_at`), which the same change widens. Nothing here cascades:
-- payment_history.subscription_id has no foreign key (0001), so a soft-deleted
-- row keeps its history, and the purge in the route is the one writer that ever
-- removes the two together.
--
-- STRICTLY ADDITIVE, like 0002 and 0003: CREATE TABLE IF NOT EXISTS, ADD COLUMN,
-- idempotent INSERT and UPDATE backfills; no DROP, no RENAME, no type change,
-- no table rebuild (tooling/ci/check-migrations.mjs bans all four). No CHECK on
-- any new column, for 0003's reason: the routes validate.
--
-- DEPLOY: this file ALONE first, then the Worker that names its columns. The
-- Worker before this change reads none of them, so the order is safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── price_change: every price edit, one row ([ADR 077] §5.2, ST-I4) ─────────
-- Written by PATCH /v1/subscriptions/:id in the same batch as the edit, only
-- when the price, the exact amount or the currency actually moved. A record of
-- what the USER typed, not of a charge: payment_history is the charges.
CREATE TABLE IF NOT EXISTS price_change (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  old_price        REAL,
  new_price        REAL,
  old_price_minor  INTEGER,
  new_price_minor  INTEGER,
  old_currency     TEXT,
  new_currency     TEXT,
  changed_at       TEXT NOT NULL      -- ISO-8601 instant
);
CREATE INDEX IF NOT EXISTS idx_price_change_user
  ON price_change (user_id);
CREATE INDEX IF NOT EXISTS idx_price_change_subscription
  ON price_change (subscription_id, changed_at);

-- ── categories: an id per category (ST-X8) ─────────────────────────────────
-- Until now a category was its English NAME, on the subscription row and as
-- budget_categories' primary key: a rename lost its cap and a built-in could
-- not be translated. A BUILT-IN row has `user_id` NULL, `builtin` 1 and a
-- stable slug for an id, which is what a client translates by; a user's own
-- category has their `user_id` and a random id. `name` is the display name for
-- a user row and the English fallback for a built-in.
--
-- The erasure walk (services/_shared/src/erasure.ts) deletes WHERE user_id = ?,
-- so it takes a person's own categories and can never reach a built-in.
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,                  -- NULL = built-in, shared by everyone
  name        TEXT NOT NULL,
  builtin     INTEGER NOT NULL DEFAULT 0,  -- boolean 0/1
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_categories_user
  ON categories (user_id);
-- One name per person. Partial, so the built-ins (user_id NULL) are outside it
-- and the route decides a clash between a user name and a built-in one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name
  ON categories (user_id, name) WHERE user_id IS NOT NULL;

-- The built-ins: the ten names the app has offered since ST-T1
-- (apps/subscriptiontracker/lib/data/seed/demo_data.dart `budget()`).
INSERT OR IGNORE INTO categories (id, user_id, name, builtin) VALUES
  ('streaming',    NULL, 'Streaming',    1),
  ('music',        NULL, 'Music',        1),
  ('ai_tools',     NULL, 'AI tools',     1),
  ('creative',     NULL, 'Creative',     1),
  ('fitness',      NULL, 'Fitness',      1),
  ('developer',    NULL, 'Developer',    1),
  ('productivity', NULL, 'Productivity', 1),
  ('cloud',        NULL, 'Cloud',        1),
  ('news',         NULL, 'News',         1),
  ('security',     NULL, 'Security',     1);

-- Every other name a person already uses becomes THEIR category, so no row is
-- left keyed by a bare name. Idempotent: a second run finds each name taken.
INSERT OR IGNORE INTO categories (id, user_id, name, builtin, created_at, updated_at)
SELECT lower(hex(randomblob(16))), used.user_id, used.name, 0,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM (SELECT user_id, category AS name FROM subscriptions
         WHERE user_id IS NOT NULL AND category IS NOT NULL AND category <> ''
        UNION
        SELECT user_id, name FROM budget_categories
         WHERE user_id IS NOT NULL AND name IS NOT NULL AND name <> '') AS used
 WHERE used.name NOT IN (SELECT name FROM categories WHERE user_id IS NULL);

-- ── the two readers of a category get its id ────────────────────────────────
-- `category` / `name` stay and stay written, in step with the id: every client
-- before this change reads only them.
ALTER TABLE subscriptions ADD COLUMN category_id TEXT;
ALTER TABLE budget_categories ADD COLUMN category_id TEXT;

UPDATE subscriptions
   SET category_id = COALESCE(
         (SELECT c.id FROM categories c
           WHERE c.user_id IS NULL AND c.name = subscriptions.category),
         (SELECT c.id FROM categories c
           WHERE c.user_id = subscriptions.user_id AND c.name = subscriptions.category))
 WHERE category_id IS NULL AND category IS NOT NULL;

UPDATE budget_categories
   SET category_id = COALESCE(
         (SELECT c.id FROM categories c
           WHERE c.user_id IS NULL AND c.name = budget_categories.name),
         (SELECT c.id FROM categories c
           WHERE c.user_id = budget_categories.user_id AND c.name = budget_categories.name))
 WHERE category_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_category
  ON subscriptions (user_id, category_id);
