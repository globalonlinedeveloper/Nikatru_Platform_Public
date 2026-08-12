-- number: retention_d1_d7_d30
-- title:  Retention
-- source: analytics-events.md § "The ~5 numbers" #2 — "D1 / D7 / D30
--         `return_visit` curve (stage 6)"
-- params: ?1 app_id · ?2 cohort_start (inclusive) · ?3 cohort_end (exclusive)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ THE WINDOW BOUNDS THE COHORT, NOT THE RETURNS — and that asymmetry is the
-- whole reason this file takes different arguments from its four siblings. D30
-- for a cohort cannot be computed inside a window that closes before day 30; a
-- query that filtered returns by `?3` as well would silently report D30 = 0 for
-- every cohort younger than the window and look perfectly healthy doing it.
-- Returns are therefore counted at ANY time at or after the install's own launch.
--
-- CLASSIC DAY-N RETENTION: retained at Dn means active ON day n, not on-or-after.
-- "On or after" is a monotonically non-increasing curve by construction, so
-- D1 >= D7 >= D30 would hold even if the underlying behaviour were the reverse —
-- an assertion that cannot fail dressed as a chart.
--
-- 🔴 THE DAY OFFSET IS COMPUTED FROM A 'YYYY-MM-DD' STRING, NOT FROM
-- `date(server_ts)`. Before the rollup cutover this file sliced
-- `substr(server_ts, 1, 10)` itself; `events_daily.day` IS that slice, written
-- once by the rollup. The reason has not changed: SQLite's date functions accept
-- a great many formats and return NULL rather than an error for the ones they do
-- not, so a client that queued an offline batch with a `+05:30` offset, or a
-- migration that widened the column, would turn every day offset into NULL and
-- every retention number into a clean, confident ZERO.
--
-- The comparison is by CALENDAR DAY in UTC, not by elapsed 24-hour periods.
-- Both are defensible; they differ, and the one that is reproducible from the
-- stored string without a timezone the row does not carry is this one.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- 🔴 THIS READS THE ROLLUP `events_daily`, NOT RAW `events`
-- (migrations/0007_events_rollup.sql). Raw `events` is swept at 400 days
-- ([ADR 045]) — and a D30 figure needs a cohort's `first_launch` row and its
-- day-30 `return_visit` row alive AT THE SAME INSTANT, which is exactly what the
-- sweep was destroying. The rollup is the copy that outlives it.
--
-- THE CALLER CONTRACT IS BYTE-FOR-BYTE UNCHANGED: still `?1` app_id, `?2`
-- cohort_start inclusive, `?3` cohort_end exclusive, still full ISO-8601 UTC
-- strings, still exactly three bound values.
--
-- ⚠️ BUT THE COHORT WINDOW IS A DAY WINDOW NOW, AND BOTH BOUNDS FLOOR. The
-- cohort is `[floor(?2), floor(?3))`. A DAY-ALIGNED window is EXACT — MEASURED,
-- not asserted: test/insights-equivalence.test.ts runs this query and the frozen
-- pre-cutover raw-`events` form (test/baselines/insights-raw/) against the SAME
-- seeded rows and compares them byte for byte.
--
-- 🔴 A SUB-DAY WINDOW IS NOT "WIDENED" — IT IS FLOORED AT BOTH ENDS, AND THE TWO
-- ENDS MOVE IN OPPOSITE DIRECTIONS: `start = …T13:00Z` takes the WHOLE of that
-- day, `end = …T13:00Z` drops the WHOLE of it, and a window opening and closing
-- inside one day returns NOTHING. Whatever eventually binds `?2`/`?3` must floor
-- them itself. (There is no `/insights` route yet, so no shipped caller does
-- this today.)
--
-- 📌 THIS FILE GOT SIMPLER, NOT MORE COMPLEX. The two `substr(…, 1, 10)`
-- wrappers inside `julianday()` are GONE: `day` is already the truncated value
-- they used to compute, so the offset arithmetic now reads what it means.
-- ═════════════════════════════════════════════════════════════════════════════
WITH cohort AS (
  -- MIN(day): an install can legitimately have more than one `first_launch` row
  -- — the client queue is at-least-once across a reinstall onto the same id —
  -- and the earliest is the one every day offset must be measured from.
  -- `MIN(day)` and `substr(MIN(server_ts), 1, 10)` are the same value: ISO-8601
  -- UTC sorts lexicographically, so truncation commutes with MIN.
  SELECT anon_id, MIN(day) AS launched_day
  FROM events_daily
  WHERE app_id = ?1
    AND event = 'first_launch'
    AND day >= substr(?2, 1, 10)
    AND day <  substr(?3, 1, 10)
  GROUP BY anon_id
),
day_offsets AS (
  SELECT
    c.anon_id,
    CAST(julianday(e.day) - julianday(c.launched_day) AS INTEGER) AS day_n
  FROM cohort c
  JOIN events_daily e
    ON e.anon_id = c.anon_id
   AND e.app_id  = ?1
  WHERE e.event = 'return_visit'
    -- ⚠️ KEPT FOR SHAPE, AND IT IS NOT LOAD-BEARING FOR THE OUTPUT — in EITHER
    -- form. A return at or before the launch instant yields `day_n <= 0`, which
    -- counts toward none of D1/D7/D30. It does differ in reach: the raw form
    -- compared INSTANTS (`e.server_ts >= c.launched_at`), so a `return_visit`
    -- earlier in the launch day was excluded; here it is included with
    -- `day_n = 0`. Same three numbers out — asserted, with exactly that
    -- adversarial row, in test/insights-equivalence.test.ts.
    AND e.day >= c.launched_day
)
-- ⚠️ NOT ONE `SUM(n_rows)` BELOW, DELIBERATELY. Every number here is a count of
-- INSTALLS — `cohort` is one row per `anon_id`, and the three retained figures
-- are `COUNT(DISTINCT anon_id)`. `n_rows` counts the raw rows that collapsed
-- into an install-day, so summing it would report return VISITS as returned
-- INSTALLS and push every retention rate above the cohort it divides by.
SELECT
  (SELECT COUNT(*) FROM cohort)                          AS cohort_size,
  COUNT(DISTINCT CASE WHEN day_n = 1  THEN anon_id END)  AS d1_retained,
  COUNT(DISTINCT CASE WHEN day_n = 7  THEN anon_id END)  AS d7_retained,
  COUNT(DISTINCT CASE WHEN day_n = 30 THEN anon_id END)  AS d30_retained,
  CASE WHEN (SELECT COUNT(*) FROM cohort) = 0 THEN NULL ELSE
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN day_n = 1  THEN anon_id END)
          / (SELECT COUNT(*) FROM cohort), 2) END        AS d1_pct,
  CASE WHEN (SELECT COUNT(*) FROM cohort) = 0 THEN NULL ELSE
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN day_n = 7  THEN anon_id END)
          / (SELECT COUNT(*) FROM cohort), 2) END        AS d7_pct,
  CASE WHEN (SELECT COUNT(*) FROM cohort) = 0 THEN NULL ELSE
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN day_n = 30 THEN anon_id END)
          / (SELECT COUNT(*) FROM cohort), 2) END        AS d30_pct
FROM day_offsets;
