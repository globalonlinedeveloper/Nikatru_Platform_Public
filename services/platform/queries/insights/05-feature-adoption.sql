-- number: feature_adoption
-- title:  Feature adoption
-- source: analytics-events.md § "The ~5 numbers" #5 — "`feature_used`
--         distribution (stage 4)"
-- params: ?1 app_id · ?2 window_start (inclusive) · ?3 window_end (exclusive)
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ONLY QUERY OF THE FIVE THAT RETURNS MANY ROWS — one per feature, ordered
-- so the answer to "what is ignored" is the bottom of the list. A feature with
-- zero uses is ABSENT rather than present with 0: the events table knows what
-- was used, not what exists, and inventing a row for a feature nobody touched
-- would require a registry of features that does not exist and would go stale.
-- Reading this list therefore answers "which of the things people use are used
-- least", and "is feature X used at all" is answered by X's absence.
--
-- 🔴 `params` IS PARSED WITH `json_extract`, NOT MATCHED AS TEXT. The taxonomy
-- says `feature_used{name}` and the column is JSON with enumerable values only
-- (0002_analytics.sql). A `LIKE '%"name":"budget_view"%'` would be defeated by
-- key order, by whitespace, and by any other param whose VALUE happened to be
-- the string `budget_view` — and this repo has already been bitten twice by
-- scanning text where it should have parsed structure (a `grep '"r2_buckets"'`
-- that matched the comment explaining their absence; two `no ip column`
-- assertions that searched an INSERT string and so could say nothing about the
-- schema).
--
-- `json_valid` + `IS NOT NULL` is a real filter, not belt-and-braces: `params`
-- defaults to `'{}'` in the DDL, so an emitter that forgot the `name` param
-- produces rows that reach here with nothing to group by. Without the guard they
-- would all collapse into one NULL bucket and appear in the report as a feature.
--
-- The denominator is ACTIVE installs in the window, not installs that used any
-- feature — "40% of active installs touched budget_view" is the decision-shaped
-- number; "40% of feature-users" is a statistic about the numerator.
-- `active` is a superset of the installs in `uses` by construction (a
-- `feature_used` row is itself activity), so it cannot be 0 while a row exists
-- and the division below cannot be 0/0.
-- ─────────────────────────────────────────────────────────────────────────────
WITH active AS (
  SELECT DISTINCT anon_id
  FROM events
  WHERE app_id = ?1
    AND server_ts >= ?2
    AND server_ts <  ?3
),
uses AS (
  SELECT json_extract(params, '$.name') AS feature, anon_id
  FROM events
  WHERE app_id = ?1
    AND event = 'feature_used'
    AND server_ts >= ?2
    AND server_ts <  ?3
    AND json_valid(params)
    AND json_extract(params, '$.name') IS NOT NULL
)
SELECT
  feature,
  COUNT(DISTINCT anon_id)                 AS installs,
  -- Rows, not installs: the ratio of the two is depth of use, and a feature with
  -- many uses across few installs is a different product signal from the reverse.
  COUNT(*)                                AS uses,
  ROUND(100.0 * COUNT(DISTINCT anon_id) / (SELECT COUNT(*) FROM active), 2) AS adoption_pct
FROM uses
GROUP BY feature
-- `feature ASC` after the count so ties are stable: an ORDER BY that leaves ties
-- to the engine makes a report that changes between two runs over identical rows.
ORDER BY installs DESC, feature ASC;
