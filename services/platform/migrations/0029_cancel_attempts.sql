-- ─────────────────────────────────────────────────────────────────────────────
-- 0029_cancel_attempts.sql — THE CANCEL EXECUTOR'S RETRY STATE
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
--   alerted_at       — when the owner was paged about this row; NULL: not yet.
--
-- ADD COLUMN only, so ledger-protected and NOT in REPLAY_SAFE_MIGRATIONS (a
-- second ADD COLUMN of the same name fails). Deployed ALONE, first: the executor
-- catches the columns' absence and does nothing until this has run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE cancellation_requests ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cancellation_requests ADD COLUMN next_attempt_at TEXT;
ALTER TABLE cancellation_requests ADD COLUMN alerted_at TEXT;
