-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_trial_price_still_using.sql — a trial knows what it will cost, a "Still
-- using?" answer lives on the row, and the nightly renewals scan has an index
-- (train T11: AD-08, IN-08, SV-02).
-- Applies to APP_DB (subscriptiontracker_db):
--   wrangler d1 migrations apply APP_DB --local   (or --remote)
--
-- Before this file:
--   · a trial converted at the price the user typed for the trial — there was
--     nowhere to say "free for 7 days, then ₹649" (AD-08);
--   · "Still using?" was answered on ONE device (the client's local store), so
--     the question came back on every other device the user owns (IN-08);
--   · the platform Worker's nightly renewals query
--     (services/platform/src/renewals.ts `recomputeRenewals`) filters on
--     `next_renewal < ?`, `status IN ('active','trialing')` and
--     `deleted_at IS NULL` with NO user_id, and the only renewal index is
--     0001's `(user_id, next_renewal)` — so every night scanned the whole table
--     (SV-02).
--
-- STRICTLY ADDITIVE, like 0002 to 0009: three ADD COLUMN and three CREATE
-- INDEX IF NOT EXISTS; no DROP, no RENAME, no type change, no table rebuild
-- (tooling/ci/check-migrations.mjs bans all four).
--
-- ⚠️ ONE CHECK, ON PURPOSE, AGAINST 0003's "NO CHECK ON ANY NEW COLUMN". That
-- rule exists because a CHECK freezes an OPEN set (status, rail, cycle_unit) at
-- today's members. `still_using` is not open: the question is yes/no, and a
-- third answer would be a different question. NULL is "not asked / not
-- answered", which the CHECK admits. The route validates it too, so a bad value
-- is a 400 naming the field and never this constraint's 500.
--
-- DEPLOY: this file ALONE first, then the Worker that names its columns, then
-- the platform Worker whose nightly limbs read them. The API Worker before this
-- change selects `*` and serializes named keys, so three extra columns are
-- invisible to it; the platform Worker probes `pragma_table_info` before naming
-- any 0003-or-later column. The order is safe both ways.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the price after the trial (AD-08) ───────────────────────────────────────
-- An exact count of the ROW's currency's minor unit — the same unit and the
-- same bound as `price_minor` (the route checks both). NULL = the trial
-- converts at the row's own price, which is what every row today does. The
-- platform Worker's nightly trial-end limb moves `price`/`price_minor` to it on
-- `trial_ends_on`, with a price_change row.
ALTER TABLE subscriptions ADD COLUMN price_after_trial_minor INTEGER;

-- ── "Still using?" (IN-08) ──────────────────────────────────────────────────
-- The user's answer and when they gave it (ISO-8601 instant, server time).
-- Written by PATCH /v1/subscriptions/:id, so every device reads the same answer
-- after a sync; the device store becomes a cache of it.
ALTER TABLE subscriptions ADD COLUMN still_using TEXT CHECK (still_using IN ('yes', 'no'));
ALTER TABLE subscriptions ADD COLUMN still_using_at TEXT;

-- ── the nightly renewals scan (SV-02) ───────────────────────────────────────
-- PARTIAL, with the scan's own predicate, so the index holds only the rows the
-- scan can return: a paused, cancelled or removed row is never in it. SQLite
-- uses a partial index only when the query's WHERE implies the index's WHERE
-- term for term, so services/platform/src/renewals.ts writes the same two
-- terms, and services/platform/test/renewals-index.test.ts holds the plan to
-- `USING INDEX`.
CREATE INDEX IF NOT EXISTS idx_subscriptions_charging_renewal
  ON subscriptions (next_renewal)
  WHERE deleted_at IS NULL AND status IN ('active', 'trialing');

-- ── the two other nightly scans (train T11, with SV-01 and AD-13) ───────────
-- The same train moves the 30-day purge of soft-deleted rows off the list read
-- and adds the trial-end step, both into the platform Worker's nightly pass
-- (services/platform/src/subscription-housekeeping.ts). Without an index each
-- would be one more whole-table scan a night, which is the defect above moved
-- rather than fixed. Both are partial, so each holds only the rows its scan can
-- return, and each query writes the index's WHERE term for term.
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_end
  ON subscriptions (trial_ends_on)
  WHERE status = 'trialing' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_deleted
  ON subscriptions (deleted_at)
  WHERE deleted_at IS NOT NULL;
