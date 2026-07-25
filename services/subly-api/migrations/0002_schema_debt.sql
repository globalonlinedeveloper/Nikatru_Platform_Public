-- ─────────────────────────────────────────────────────────────────────────────
-- 0002_schema_debt.sql — pay down subly_db's two addressability gaps. Applies to
-- APP_DB (subly_db):  wrangler d1 migrations apply APP_DB --local  (or --remote)
--
-- Found by the 2026-07-25 sync-design audit against the LIVE 0001_init.sql:
--   • budget_categories had PRIMARY KEY (user_id, name) and NO single-column id
--     → the row is unaddressable as (entity, row_id), and renaming a category
--       would read as delete+create rather than an edit.
--   • payment_history had no updated_at → no way to tell a stale row from a
--     fresh one, so any last-write-wins merge is undecidable for that table.
--
-- Both are cheap now and a fleet migration later. STRICTLY ADDITIVE (see
-- company/requirements/schema-evolution.md): no DROP, no RENAME, no type change,
-- and no table rebuild — the composite PRIMARY KEY stays exactly where it is and
-- keeps enforcing UNIQUE(user_id, name). `id` becomes the ADDRESSING key without
-- becoming the SQL primary key, which is all sync needs.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── budget_categories: surrogate id ─────────────────────────────────────────
-- Nullable by necessity (SQLite cannot ADD a NOT NULL column without a constant
-- default, and a constant default would collide). New rows are written with a
-- client-generated UUIDv7; the backfill below covers rows already in the wild.
ALTER TABLE budget_categories ADD COLUMN id TEXT;

-- Backfill legacy rows. randomblob(16) is NOT a UUIDv7 — these are pre-existing
-- rows with no meaningful creation time to encode, and the id only has to be
-- unique and stable. Idempotent: re-running touches nothing.
UPDATE budget_categories
   SET id = lower(hex(randomblob(16)))
 WHERE id IS NULL OR id = '';

-- Partial index so the constraint holds without blocking a row mid-insert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_categories_id
  ON budget_categories (id) WHERE id IS NOT NULL;

-- ── payment_history: updated_at ─────────────────────────────────────────────
ALTER TABLE payment_history ADD COLUMN updated_at TEXT;

-- Seed from the only timestamp the table has. Rows with neither stay NULL,
-- which reads correctly as "never modified since creation".
UPDATE payment_history
   SET updated_at = paid_at
 WHERE updated_at IS NULL AND paid_at IS NOT NULL;

-- NOTE: `budgets` keeps user_id as its primary key on purpose — it is a
-- per-user SINGLETON entity, so row_id = user_id. Flagged, not changed.
