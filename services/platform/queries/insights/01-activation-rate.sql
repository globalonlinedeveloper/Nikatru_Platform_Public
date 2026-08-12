-- number: activation_rate
-- title:  Activation rate
-- source: analytics-events.md § "The ~5 numbers" #1 — "% of new users hitting
--         `activation` (stage 3)"
-- params: ?1 app_id · ?2 window_start (inclusive) · ?3 window_end (exclusive)
-- ─────────────────────────────────────────────────────────────────────────────
-- "NEW USERS" IS `first_launch`, AND THE DENOMINATOR IS INSTALLS, NOT PEOPLE.
-- The taxonomy renamed this event from `first_open`/`app_install` on 2026-07-25
-- for exactly this reason: a reinstall is indistinguishable from a new user, so
-- the cohort below is install-level. Calling it "new users" in a report without
-- that caveat overstates acquisition by however much churn-and-return there is.
--
-- 🔴 0 / 0 IS `NULL`, NOT `0`. Zero percent is the claim "a cohort existed and
-- none of it activated". No cohort at all is a different statement, and today it
-- is the TRUE one: `events` holds 0 rows in production (E-4a). A query that
-- answered `0.0` here would hand the owner a real-looking bad number produced by
-- an empty table — the exact shape of failure E-13 exists to catch, manufactured
-- by the reporting layer instead of detected by it.
--
-- The `activation` half carries no lower time bound on purpose. An install
-- qualifies for the cohort only if its `first_launch` is inside the window, so
-- any later `activation` is necessarily inside it too; adding `>= ?2` would be
-- an assertion that cannot fail. The UPPER bound is load-bearing — without it
-- the rate for a closed historical window would keep creeping up as late
-- activations landed, and two runs of the same report would disagree.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- 🔴 THIS READS THE ROLLUP `events_daily`, NOT RAW `events`
-- (migrations/0007_events_rollup.sql). Raw `events` is swept at 400 days
-- ([ADR 045]); the rollup is the only copy of this number's inputs that outlives
-- that sweep, so a query still on the raw table is a number with an expiry date.
--
-- THE CALLER CONTRACT IS BYTE-FOR-BYTE UNCHANGED: still `?1` app_id, `?2`
-- window_start inclusive, `?3` window_end exclusive, still full ISO-8601 UTC
-- strings, still exactly three bound values. The day truncation happens INSIDE
-- the SQL (`substr(?N, 1, 10)`), so nothing above this file had to move.
--
-- ⚠️ BUT THE WINDOW IS A DAY WINDOW NOW, AND BOTH BOUNDS FLOOR. This answers
-- over `[floor(?2), floor(?3))`. A DAY-ALIGNED window is EXACT — not asserted,
-- MEASURED: test/insights-equivalence.test.ts runs this query and the frozen
-- pre-cutover raw-`events` form (test/baselines/insights-raw/) against the SAME
-- seeded rows and compares them byte for byte.
--
-- 🔴 A SUB-DAY WINDOW IS NOT "WIDENED" — IT IS FLOORED AT BOTH ENDS, AND THE TWO
-- ENDS MOVE IN OPPOSITE DIRECTIONS. `start = …T13:00Z` picks up the WHOLE of
-- that day (MORE than was asked for); `end = …T13:00Z` drops the WHOLE of that
-- day (LESS); a window that opens and closes inside one day returns NOTHING AT
-- ALL. (An earlier wording of this note, in 0007's header and in [ADR 045] §8.2,
-- said "silently widened to day bounds" — half right, and the wrong half is the
-- one that loses data. Both directions are measured in
-- test/insights-equivalence.test.ts § "the day window is a REAL loss".)
-- There is no `/insights` route yet, so no shipped caller passes a sub-day
-- window today; this is a constraint on the caller that does not exist yet.
-- Whatever eventually binds `?2`/`?3` must floor them itself, or the number it
-- prints is not the number it asked for.
-- ═════════════════════════════════════════════════════════════════════════════
WITH cohort AS (
  SELECT DISTINCT anon_id
  FROM events_daily
  WHERE app_id = ?1
    AND event = 'first_launch'
    AND day >= substr(?2, 1, 10)
    AND day <  substr(?3, 1, 10)
),
activated AS (
  SELECT DISTINCT e.anon_id
  FROM events_daily e
  JOIN cohort c ON c.anon_id = e.anon_id
  WHERE e.app_id = ?1
    AND e.event = 'activation'
    AND e.day < substr(?3, 1, 10)
)
-- ⚠️ STILL `COUNT(*)`, NEVER `SUM(n_rows)`. Both counts below range over a
-- DISTINCT-`anon_id` CTE, so each row IS one install; `n_rows` is how many raw
-- `first_launch`/`activation` rows collapsed into that install-day, which is a
-- different quantity. Summing it here would turn "installs that activated" into
-- "activation events" and inflate the rate past 100 % the first time a client
-- re-sent a queued batch.
SELECT
  (SELECT COUNT(*) FROM cohort)    AS new_installs,
  (SELECT COUNT(*) FROM activated) AS activated_installs,
  CASE
    WHEN (SELECT COUNT(*) FROM cohort) = 0 THEN NULL
    ELSE ROUND(
      100.0 * (SELECT COUNT(*) FROM activated) / (SELECT COUNT(*) FROM cohort),
      2
    )
  END AS activation_rate_pct;
