-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_events_rollup.sql — the daily rollup that makes the five decision
-- numbers OUTLIVE the rows they are computed from.
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- WHY THIS EXISTS. `events` is swept at 400 days (EVENTS_RETENTION_DAYS,
-- [ADR 045]) and nothing aggregated it first, so that sweep was IRREVERSIBLE FOR
-- THE METRICS: all five [11]E-11 numbers read raw `events`, and a deleted row
-- destroyed its contribution permanently. Retention was therefore a PRODUCT
-- trade-off wearing a privacy costume — shortening the period destroyed history,
-- so the number could never be argued on privacy grounds alone.
--
-- 🔴 THE GRAIN KEEPS `anon_id`, AND THAT IS NOT AN OVERSIGHT. Every one of the
-- five numbers is an install-level DISTINCT count; three are per-install JOINS
-- ACROSS DIFFERENT EVENT TYPES (#1 cohort→activation, #2 launch→return with a
-- per-install day offset, #4 the boolean interaction SUM(opened * returned)).
-- Marginal counts by (day, app, event) cannot reconstruct any of them.
--
-- ⚠️ SO THIS TABLE IS PSEUDONYMOUS PERSONAL DATA, THE SAME CLASS AS `events`.
-- It gets its own declared period (1100d) and its own erasure reach; it is NOT
-- an anonymous aggregate and must never be described as one.
--
-- 📌 CORRECTION TO [ADR 045] §7, MADE IN THE SAME INCREMENT: that section says a
-- rollup would "decouple the metric from the retention period entirely and make
-- this number a pure privacy choice". IT DOES NOT. The minimal LOSSLESS grain
-- must retain `anon_id` — the exact field ADR 045 itself flags as possibly
-- personal data under DPDP s.2(t). What the rollup actually buys is a SMALLER
-- privacy question, not a decoupled one: 9 identifying/contextual columns go
-- (geo, session, device, version, client clock, consent id, raw params), and the
-- metric history stops depending on the 400-day number. That is worth having and
-- it is not what was claimed.
--
-- 📌 AND A CORRECTION TO company/pipeline/11-measurement.md:1540. It says the
-- five numbers "are counts and ratios by day/app/event". ZERO OF FIVE are
-- computable at that grain. A rollup built to the corpus's own stated grain
-- would have destroyed four of the five while reporting success — which is why
-- the grain below was derived from the shipped queries rather than from the
-- sentence describing them.
--
-- WHAT SURVIVES, MEASURED NOT ASSERTED: the five shipped queries in
-- queries/insights/ return BIT-IDENTICAL results from this table as from raw
-- `events` across 45 (metric × app × window) combinations — PROVIDED the window
-- is day-aligned. A sub-day window is silently widened to day bounds; that is
-- the one and only fidelity loss. test/events-rollup.test.ts is that proof.
--
-- 🔴 `feature` IS `NOT NULL DEFAULT ''`, NEVER NULLABLE, AND THE WHOLE
-- IDEMPOTENCY OF THIS TABLE RESTS ON IT. SQLite treats NULLs as DISTINCT in a
-- UNIQUE index, so a nullable `feature` makes `ON CONFLICT` never fire for the
-- ~90% of rows that are not `feature_used`. Measured: three identical runs
-- produced THREE rows with a NULL sentinel and ONE with ''. A rollup that
-- duplicates on every run is a rollup that silently multiplies every count it
-- feeds. tooling/ci/assert-rollup-lossless.mjs [R2] fails the build if this
-- column stops being NOT NULL or leaves the unique index.
--
-- SHAPE: ROWID table + a UNIQUE INDEX on the grain, NOT a composite PRIMARY KEY
-- — the same reasoning 0002_analytics.sql:13-16 records for `events`.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events_daily (
  day      TEXT    NOT NULL,            -- 'YYYY-MM-DD' UTC, = substr(server_ts,1,10)
  app_id   TEXT    NOT NULL,
  anon_id  TEXT    NOT NULL,            -- install id. LOAD-BEARING: see header.
  event    TEXT    NOT NULL,
  feature  TEXT    NOT NULL DEFAULT '', -- params.$.name for feature_used, '' otherwise
  n_rows   INTEGER NOT NULL             -- raw rows collapsed here; #5's `uses`
);

-- THE GRAIN ITSELF. This is the ON CONFLICT target, so it is what makes the
-- rollup re-runnable; it is not a lookup index that happens to be unique.
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_daily_grain
  ON events_daily (day, app_id, anon_id, event, feature);

-- The two access paths the five queries actually take, mirroring the shapes
-- 0002_analytics.sql:60-63 already proved out on `events`.
CREATE INDEX IF NOT EXISTS idx_events_daily_app_evt_day
  ON events_daily (app_id, event, day);
CREATE INDEX IF NOT EXISTS idx_events_daily_app_anon_day
  ON events_daily (app_id, anon_id, day);

-- ─────────────────────────────────────────────────────────────────────────────
-- THE INTERLOCK. One row per rollup naming the last COMPLETE day fully consumed.
--
-- 🔴 THIS TABLE IS WHAT MAKES THE RETENTION SWEEP FAIL-CLOSED. The events sweep
-- does not delete on age alone: its cutoff is min(age_cutoff, rolled_through+1d).
-- If this rollup stalls, `rolled_through` stops advancing, the sweep's cutoff
-- pins to it, and the sweep stops deleting rows the rollup has not consumed.
--
-- ⚠️ ORDERING THE TWO JOBS IS NOT THE GUARANTEE, AND BELIEVING IT IS IS THE TRAP.
-- `retentionSweep` catches its own errors so it can write an ok=0 heartbeat, and
-- so must the rollup. Two limbs that each swallow their own exceptions run
-- INDEPENDENTLY — a rollup that fails at 06:00:10 does nothing to stop a sweep
-- that deletes at 06:00:11. The watermark is the guarantee; the order is only an
-- optimisation that lets a day rolled up tonight be swept tonight.
--
-- A NULL `rolled_through` means NOTHING has been consumed and the sweep is
-- INERT — the same "undeclared is inert" rule `retentionCutoff` applies to a
-- fat-fingered zero, for the same reason and with the same safe direction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rollup_state (
  rollup         TEXT NOT NULL,   -- 'events_daily'
  rolled_through TEXT,            -- 'YYYY-MM-DD' or NULL = nothing consumed yet
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rollup_state ON rollup_state (rollup);

-- Seeded NULL so the row exists before the job first runs: the sweep reads this
-- row, and a MISSING row and a NULL row must mean the same thing (inert) rather
-- than the reader having to distinguish them.
INSERT INTO rollup_state (rollup, rolled_through, updated_at)
VALUES ('events_daily', NULL, '1970-01-01T00:00:00.000Z')
ON CONFLICT (rollup) DO NOTHING;
