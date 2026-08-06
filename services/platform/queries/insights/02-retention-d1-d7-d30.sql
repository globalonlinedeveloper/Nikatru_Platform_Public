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
-- 🔴 THE DAY OFFSET IS COMPUTED FROM `substr(server_ts, 1, 10)`, NOT FROM
-- `date(server_ts)`. The rail writes `nowIso()` (routes/events.ts), i.e. an
-- ISO-8601 string with a `Z` suffix. SQLite's date functions do accept that, but
-- they accept a great many other things too and return NULL rather than an error
-- for the ones they do not — so a future client that queued an offline batch
-- with a `+05:30` offset, or a migration that widened the column, would turn
-- every day offset into NULL and every retention number into a clean, confident
-- ZERO. Slicing the first ten characters is a total function on the format the
-- column is documented to hold, and it is the same 'YYYY-MM-DD' the D1 edge
-- writes for every row.
--
-- The comparison is by CALENDAR DAY in UTC, not by elapsed 24-hour periods.
-- Both are defensible; they differ, and the one that is reproducible from the
-- stored string without a timezone the row does not carry is this one.
-- ─────────────────────────────────────────────────────────────────────────────
WITH cohort AS (
  -- MIN(server_ts): an install can legitimately have more than one `first_launch`
  -- row — the client queue is at-least-once across a reinstall onto the same
  -- id — and the earliest is the one every day offset must be measured from.
  SELECT anon_id, MIN(server_ts) AS launched_at
  FROM events
  WHERE app_id = ?1
    AND event = 'first_launch'
    AND server_ts >= ?2
    AND server_ts <  ?3
  GROUP BY anon_id
),
day_offsets AS (
  SELECT
    c.anon_id,
    CAST(
      julianday(substr(e.server_ts, 1, 10)) - julianday(substr(c.launched_at, 1, 10))
      AS INTEGER
    ) AS day_n
  FROM cohort c
  JOIN events e
    ON e.anon_id = c.anon_id
   AND e.app_id  = ?1
  WHERE e.event = 'return_visit'
    AND e.server_ts >= c.launched_at
)
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
