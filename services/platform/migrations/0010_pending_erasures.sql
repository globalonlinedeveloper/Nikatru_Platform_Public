-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_pending_erasures.sql — AN ERASURE AN APP COULD NOT FINISH, WRITTEN DOWN.
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- [ADR 081] (owner, 2026-09-15, "Accept, build it (Recommended)"). When
-- DELETE /v1/account cannot reach an app Worker, the route records one order per
-- (subject, app) here and answers 202 erasure_pending instead of 502. The nightly
-- cron (services/platform/src/scheduled.ts `erasureRetry`) calls the app's
-- `ErasureEntrypoint` over a Service Binding, with backoff, and deletes the
-- subject's orders once every app has confirmed AND the identity record is gone.
-- Identity stays LAST: a subject with an unconfirmed order keeps its identity.
--
-- 🔴 NO `user_id` COLUMN AND NO `*_user_id` COLUMN, AND THAT IS THE ONE RULE THIS
-- TABLE CANNOT BREAK. The erasure walk derives its targets from exactly those
-- names (services/_shared/src/erasure.ts `userOwnedTables` /
-- `userReferencingColumns`): a ledger column named `user_id` would be DELETED by
-- the very erasure it records, mid-request, and a `subject_user_id` would be
-- NULLed — either way the order vanishes and the retry never happens. The
-- subject is therefore `subject_ref`, a neutral name holding the user id.
--
-- RETENTION: a row lives until its subject's erasure completes (every app
-- confirmed and the identity deleted), then `erasureRetry` deletes it. There is
-- no time-based sweep on purpose: deleting an unfinished order by age would
-- silently abandon an erasure. An order stuck past ERASURE_STUCK_AFTER_DAYS
-- writes an ok=0 `erasure_retry` heartbeat instead, which is RED in the ops register.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_erasures (
  order_id         TEXT PRIMARY KEY NOT NULL,
  subject_ref      TEXT NOT NULL,
  app_id           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT NOT NULL,
  last_attempt_at  TEXT,
  last_error       TEXT,
  confirmed_at     TEXT,
  UNIQUE (subject_ref, app_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_erasures_due ON pending_erasures (confirmed_at, next_attempt_at);
