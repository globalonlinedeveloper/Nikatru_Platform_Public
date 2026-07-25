-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_init.sql — starter per-app schema for {{app_id}}. Applies to APP_DB:
--   wrangler d1 migrations apply APP_DB --local  (or --remote)
-- Replace/extend `records` with this app's real tables. EVERY user-owned table
-- MUST carry a user_id column so the account-deletion route can purge it.
--
-- ── TWO RULES EVERY TABLE IN EVERY STAMPED APP MUST FOLLOW ──────────────────
--
-- 1. SINGLE-COLUMN, CLIENT-GENERATED UUIDv7 `id TEXT PRIMARY KEY`.
--    Never a composite primary key. Sync addresses rows as (entity, row_id) and
--    a composite key cannot be addressed that way; discovering this at app #7
--    with data in the wild is a fleet migration, not a fix. UUIDv7 (not v4) so
--    ids sort by creation time and keep index locality.
--
-- 2. THE SYNC ENVELOPE (below) ON EVERY USER-OWNED TABLE, FROM DAY ONE.
--    [ADR 014] is designed but NOT locked — these columns are deliberately
--    shipped ahead of that decision because they cost NOTHING at rest today
--    (six nullable/defaulted columns no code reads) and cost a coordinated
--    ALTER + backfill across every app database AND every already-released
--    client in year two. `ALTER TABLE ADD COLUMN` in SQLite physically cannot
--    add a NOT NULL column without a constant default, so shipping them now is
--    also what keeps the additive-only rule achievable later.
--
-- SCHEMA EVOLUTION IS ADDITIVE-ONLY — see company/requirements/schema-evolution.md.
-- No DROP, no RENAME, no type change, no nullable→NOT NULL. CI enforces it
-- (tooling/ci/check-migrations.mjs).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS records (
  id          TEXT PRIMARY KEY,      -- client-generated UUIDv7
  user_id     TEXT NOT NULL,
  title       TEXT,
  body        TEXT,
  created_at  TEXT,
  updated_at  TEXT,

  -- ── sync envelope (37-SYNC Phase 0) ──────────────────────────────────────
  -- Server-assigned per-user sequence. 0 = the server has never acknowledged
  -- this row. THE pull cursor: clients ask for everything above their high-water
  -- mark, so it must be dense and monotonic per user.
  server_seq       INTEGER NOT NULL DEFAULT 0,
  -- Server clock at last accepted write. The LWW tiebreak — never the client's.
  server_ts        TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  -- Soft delete. A hard DELETE is invisible to a device that is offline during
  -- it, so deletes must be replicable rows, purged later by the nightly cron.
  deleted          INTEGER NOT NULL DEFAULT 0,
  -- Client-generated UUIDv7 of the mutation that last wrote this row — the
  -- idempotency key that makes an at-least-once push exactly-once.
  last_mutation_id TEXT,
  -- App Schema Version of the writer. Lets the server reason about a row written
  -- by a client build that is older or NEWER than itself.
  last_writer_asv  INTEGER NOT NULL DEFAULT 1,
  -- Columns a given build does not know about, round-tripped verbatim so an old
  -- client editing a row cannot silently destroy a newer client's fields.
  forward_json     TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_records_user ON records (user_id);
-- THE pull index: "everything this user changed after seq N", in seq order.
CREATE INDEX IF NOT EXISTS idx_records_pull ON records (user_id, server_seq);
-- Bootstrap keyset pagination for a first full download.
CREATE INDEX IF NOT EXISTS idx_records_boot ON records (user_id, id);
