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
-- ─────────────────────────────────────────────────────────────────────────────
WITH cohort AS (
  SELECT DISTINCT anon_id
  FROM events
  WHERE app_id = ?1
    AND event = 'first_launch'
    AND server_ts >= ?2
    AND server_ts <  ?3
),
activated AS (
  SELECT DISTINCT e.anon_id
  FROM events e
  JOIN cohort c ON c.anon_id = e.anon_id
  WHERE e.app_id = ?1
    AND e.event = 'activation'
    AND e.server_ts < ?3
)
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
