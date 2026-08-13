-- ⛔ FROZEN BASELINE — DO NOT EDIT, DO NOT "UPDATE IT TO MATCH". ⛔
-- ─────────────────────────────────────────────────────────────────────────────
-- EVERYTHING BELOW THIS BANNER is the PRE-CUTOVER text of the query of the same
-- name in services/platform/queries/insights/ — byte-identical to what shipped in
-- 51bf1a2, and reading raw `events`. It is kept so test/insights-equivalence.test.ts can
-- run BOTH forms of every metric against ONE seeded fixture and compare them
-- byte for byte — which is what makes "the cutover changed no number" a
-- measurement rather than a claim.
--
-- 🔴 THIS IS THE SPECIFICATION, NOT A MIRROR. If a shipped query ever stops
-- matching this file, the question is WHICH OF THE TWO IS WRONG. Copying the new
-- text down here would turn the equivalence test into a comparison of a string
-- with itself — an assertion that cannot fail, which is worse than none because
-- it inflates apparent coverage. The test refuses to run if that happens: it
-- asserts every baseline reads `events`, that none mentions `events_daily`, and
-- that every shipped query is the other way round.
--
-- Nothing loads these files at runtime. They are test data, and the shipped
-- query set is still exactly the five .sql files in queries/insights/.
-- ─────────────────────────────────────────────────────────────────────────────
-- number: notification_lift
-- title:  Notification lift
-- source: analytics-events.md § "The ~5 numbers" #4 — "`notification_opened`-
--         driven return vs `notif_opt_out` (stage 6)"
-- params: ?1 app_id · ?2 window_start (inclusive) · ?3 window_end (exclusive)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ THIS IS AN OBSERVED DIFFERENCE, NOT A CAUSAL LIFT, AND THE COLUMN IS NAMED
-- `lift_pct_points` RATHER THAN `lift_pct` SO NOBODY MULTIPLIES IT BY ANYTHING.
-- Installs that open notifications are already the more engaged ones; the split
-- below is self-selected, so the gap it measures is an upper bound on what
-- notifications contribute and would be positive even if they contributed
-- nothing. A causal number needs a randomised hold-out, which needs
-- `variant_exposed` emitted at call sites (E-12, wired but at 0 call sites).
-- Recorded here rather than in a doc because this is the file somebody reads
-- when they want to justify sending more push.
--
-- The measure is a DIFFERENCE OF PERCENTAGES (percentage POINTS), not a ratio.
-- A ratio explodes when the control rate approaches zero and reads as a
-- spectacular result computed from two or three installs.
--
-- `notif_opt_out` is reported as its own count, deliberately NOT folded into the
-- lift. The taxonomy names it as the counterweight — the cost side of sending
-- more — and a single blended number would let a rising opt-out rate hide inside
-- a rising lift. Two numbers, one decision.
--
-- The base population is every install with ANY event in the window, so the
-- control group is "active and did not open one", not "did not open one" —
-- otherwise every dormant install in history would be counted as a
-- non-returning control and the lift would be an artifact of how long the app
-- has existed.
-- ─────────────────────────────────────────────────────────────────────────────
WITH active AS (
  SELECT DISTINCT anon_id
  FROM events
  WHERE app_id = ?1
    AND server_ts >= ?2
    AND server_ts <  ?3
),
flags AS (
  -- EXISTS yields 0/1 in SQLite, which is what makes the SUMs below plain
  -- counting rather than a second pass of DISTINCT bookkeeping.
  SELECT
    a.anon_id,
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.app_id = ?1 AND e.anon_id = a.anon_id
        AND e.event = 'notification_opened'
        AND e.server_ts >= ?2 AND e.server_ts < ?3
    ) AS opened,
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.app_id = ?1 AND e.anon_id = a.anon_id
        AND e.event = 'return_visit'
        AND e.server_ts >= ?2 AND e.server_ts < ?3
    ) AS returned,
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.app_id = ?1 AND e.anon_id = a.anon_id
        AND e.event = 'notif_opt_out'
        AND e.server_ts >= ?2 AND e.server_ts < ?3
    ) AS opted_out
  FROM active a
),
agg AS (
  -- COALESCE because SUM over ZERO ROWS is NULL, and the counts must be 0 there:
  -- "no installs" is a fact about the population and belongs in the count, while
  -- NULL belongs only in the RATES, which genuinely have no value at 0/0.
  SELECT
    COALESCE(SUM(opened), 0)                     AS opened_installs,
    COALESCE(SUM(opened * returned), 0)          AS opened_returned,
    COALESCE(SUM(1 - opened), 0)                 AS not_opened_installs,
    COALESCE(SUM((1 - opened) * returned), 0)    AS not_opened_returned,
    COALESCE(SUM(opted_out), 0)                  AS opted_out_installs
  FROM flags
)
SELECT
  opened_installs,
  opened_returned,
  not_opened_installs,
  not_opened_returned,
  opted_out_installs,
  CASE WHEN opened_installs = 0 THEN NULL
       ELSE ROUND(100.0 * opened_returned / opened_installs, 2) END
    AS opened_return_pct,
  CASE WHEN not_opened_installs = 0 THEN NULL
       ELSE ROUND(100.0 * not_opened_returned / not_opened_installs, 2) END
    AS not_opened_return_pct,
  CASE WHEN opened_installs = 0 OR not_opened_installs = 0 THEN NULL
       ELSE ROUND(
         100.0 * opened_returned / opened_installs
         - 100.0 * not_opened_returned / not_opened_installs, 2) END
    AS lift_pct_points
FROM agg;
