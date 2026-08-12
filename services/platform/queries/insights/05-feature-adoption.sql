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
-- 🔴 `params` IS PARSED WITH `json_extract`, NOT MATCHED AS TEXT — AND THAT
-- PARSE NOW HAPPENS ONCE, IN THE ROLLUP, NOT HERE. `events_daily.feature` is
-- `CAST(json_extract(params, '$.name') AS TEXT)` computed by the rollup INSERT
-- (src/scheduled.ts) at the moment the day was consumed. The reasoning is
-- unchanged and still worth keeping: a `LIKE '%"name":"budget_view"%'` would be
-- defeated by key order, by whitespace, and by any other param whose VALUE
-- happened to be the string `budget_view` — and this repo has already been
-- bitten twice by scanning text where it should have parsed structure (a
-- `grep '"r2_buckets"'` that matched the comment explaining their absence; two
-- `no ip column` assertions that searched an INSERT string and so could say
-- nothing about the schema).
--
-- `feature <> ''` REPLACES `json_valid(params) AND json_extract(…) IS NOT NULL`:
-- `params` defaults to `'{}'` in the DDL, so an emitter that forgot the `name`
-- param produces rows that would otherwise collapse into one NULL bucket and
-- appear in the report as a feature. The rollup ALREADY applied that filter and
-- wrote the `''` sentinel where it failed, so the same rows are excluded by the
-- same rule — one place, one time, instead of on every read.
--
-- The denominator is ACTIVE installs in the window, not installs that used any
-- feature — "40% of active installs touched budget_view" is the decision-shaped
-- number; "40% of feature-users" is a statistic about the numerator.
-- `active` is a superset of the installs in `uses` by construction (a
-- `feature_used` row is itself activity), so it cannot be 0 while a row exists
-- and the division below cannot be 0/0.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- 🔴 THIS READS THE ROLLUP `events_daily`, NOT RAW `events`
-- (migrations/0007_events_rollup.sql). Raw `events` is swept at 400 days
-- ([ADR 045]); the rollup is the copy of this distribution's inputs that
-- outlives the sweep.
--
-- THE CALLER CONTRACT IS BYTE-FOR-BYTE UNCHANGED: still `?1` app_id, `?2`
-- window_start inclusive, `?3` window_end exclusive, still full ISO-8601 UTC
-- strings, still exactly three bound values.
--
-- ⚠️ THE WINDOW IS A DAY WINDOW NOW, AND BOTH BOUNDS FLOOR — `[floor(?2),
-- floor(?3))`. A DAY-ALIGNED window is EXACT, MEASURED against the frozen
-- pre-cutover raw-`events` form in test/baselines/insights-raw/ by
-- test/insights-equivalence.test.ts. A SUB-DAY window is NOT "widened": both
-- ends floor, so the start takes the whole of its day and the end drops the
-- whole of its own, and a window inside one day returns nothing.
--
-- 🔴 AND THIS FILE CARRIES A SECOND, SEPARATE FIDELITY LOSS THAT 0007's HEADER
-- DID NOT RECORD — TWO OF THEM, BOTH MEASURED, BOTH ABOUT `feature` RATHER THAN
-- ABOUT TIME:
--   (a) A FEATURE LITERALLY NAMED `''`. `{"name":""}` was a real, counted
--       feature against raw `events` (`json_extract` returns the empty string,
--       which is NOT NULL). In the rollup it is indistinguishable from the
--       `''` sentinel that means "no name", so `feature <> ''` drops it. One
--       feature disappears from the report rather than one number moving.
--   (b) A NON-STRING NAME. `{"name":42}` reached this query as the INTEGER 42
--       off raw `events`; the rollup's `CAST(… AS TEXT)` — which is what keeps
--       the unique index from treating 42 and '42' as two grain rows — makes it
--       the TEXT '42'. Same feature, different column TYPE in the result.
-- Both are out-of-taxonomy inputs (`analytics-events.md` says `feature_used`
-- carries an enumerable NAME), and in both the rollup's answer is arguably the
-- better one. They are recorded because "the day window is the one and only
-- fidelity loss" was FALSE, and a wrong count of the known losses is how the
-- next one gets missed. Both are asserted, with those exact rows, in
-- test/insights-equivalence.test.ts § "known divergences, measured".
-- ═════════════════════════════════════════════════════════════════════════════
WITH active AS (
  SELECT DISTINCT anon_id
  FROM events_daily
  WHERE app_id = ?1
    AND day >= substr(?2, 1, 10)
    AND day <  substr(?3, 1, 10)
),
uses AS (
  SELECT feature, anon_id, n_rows
  FROM events_daily
  WHERE app_id = ?1
    AND event = 'feature_used'
    AND day >= substr(?2, 1, 10)
    AND day <  substr(?3, 1, 10)
    AND feature <> ''
)
SELECT
  feature,
  COUNT(DISTINCT anon_id)                 AS installs,
  -- 🔴 THE ONE AND ONLY `SUM(n_rows)` IN THE FIVE QUERIES, and it is here
  -- because `uses` is the one and only metric that counts ROWS. Pre-cutover this
  -- was `COUNT(*)` over raw rows; the rollup collapsed those rows per
  -- (day, install, feature) and put the count it collapsed into `n_rows`, so the
  -- sum of `n_rows` IS that `COUNT(*)`. `installs` beside it stays
  -- `COUNT(DISTINCT anon_id)`, and the ratio of the two is depth of use — a
  -- feature with many uses across few installs is a different product signal
  -- from the reverse.
  SUM(n_rows)                             AS uses,
  -- `COUNT(*)` over `active`, NOT `SUM(n_rows)`: `active` is a DISTINCT-anon_id
  -- CTE, so its row count is installs. This denominator is the one place a
  -- careless `SUM` would silently divide by event volume and drive every
  -- adoption percentage toward zero as the app got busier.
  ROUND(100.0 * COUNT(DISTINCT anon_id) / (SELECT COUNT(*) FROM active), 2) AS adoption_pct
FROM uses
GROUP BY feature
-- `feature ASC` after the count so ties are stable: an ORDER BY that leaves ties
-- to the engine makes a report that changes between two runs over identical rows.
ORDER BY installs DESC, feature ASC;
