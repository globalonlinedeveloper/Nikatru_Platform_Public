-- Cron heartbeat: makes "did the nightly job actually run?" a QUERY, not a guess.
--
-- WHY. keepAliveSupabase exists to stop Supabase auto-pausing a free-tier project
-- after ~7 days idle, which would break sign-in portfolio-wide. It swallowed its
-- own errors and wrote nothing down, so a keep-alive that had been failing every
-- night for a month looked exactly like one that was working -- and the first
-- signal would be a pause email for the LIVE auth project. That is this repo's
-- most repeated failure shape: silence read as success.
--
-- Append-only, one row per (job, target) per run, so a run of consecutive
-- failures is visible rather than overwritten. ~365 rows/year/target: no pruning
-- needed, and the additive-only schema rule forbids dropping it anyway.
CREATE TABLE IF NOT EXISTS cron_heartbeat (
  job     TEXT NOT NULL,
  target  TEXT NOT NULL,
  ok      INTEGER NOT NULL,
  detail  TEXT,
  ran_at  TEXT NOT NULL
);

-- "when did each target last succeed?" is the question this table exists to answer.
CREATE INDEX IF NOT EXISTS idx_cron_heartbeat_job_ran ON cron_heartbeat (job, ran_at);
