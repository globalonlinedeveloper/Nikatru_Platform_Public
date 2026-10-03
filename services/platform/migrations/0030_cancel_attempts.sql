-- ─────────────────────────────────────────────────────────────────────────────
-- 0030_cancel_attempts.sql — THE CANCEL EXECUTOR'S RETRY STATE
-- (refund-finish; O-CANCEL-EXECUTOR-UNBUILT).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- A cancellation the rail did not confirm used to wait for a human
-- (src/routes/cancellation.ts, `executed_at` NULL). src/lib/mor/cancel-executor.ts
-- now retries it on the nightly firing, through the payments port, with a
-- backoff, and pages the owner once after CANCEL_ALERT_AFTER_ATTEMPTS failures.
-- These three columns are its state:
--   attempts         — executor attempts so far (the route's own try is not one);
--   next_attempt_at  — not before this instant (ISO-8601); NULL is "now";
--   alerted_at       — when the owner was paged about this row; NULL: not yet;
--   backlog          — 🔴 THE CUTOFF (review 2026-10-03). Its DEFAULT is 1, so
--                      every row that exists when this runs — the backlog
--                      recorded before the executor existed — reads 1, and the
--                      executor never acts on it: it counts it and reports it,
--                      and a person works it. routes/cancellation.ts writes 0 on
--                      every row it records from now on. An ADD COLUMN with a
--                      constant default, not an UPDATE, so the set stays
--                      replay-classifiable (test/migrations-replay.test.ts). A
--                      row recorded between this migration and the code deploy
--                      reads 1 too: skipped and reported, never acted on.
--
-- ADD COLUMN only, so ledger-protected and NOT in REPLAY_SAFE_MIGRATIONS (a
-- second ADD COLUMN of the same name fails). Deployed ALONE, first: the executor
-- catches the columns' absence and does nothing until this has run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE cancellation_requests ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cancellation_requests ADD COLUMN next_attempt_at TEXT;
ALTER TABLE cancellation_requests ADD COLUMN alerted_at TEXT;
ALTER TABLE cancellation_requests ADD COLUMN backlog INTEGER NOT NULL DEFAULT 1;
