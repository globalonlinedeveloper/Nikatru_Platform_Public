-- ─────────────────────────────────────────────────────────────────────────────
-- 0005_cancellation_requests.sql — THE USER'S OWN RECORD OF ASKING TO CANCEL.
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- [pipeline 5]M-9 — "a user can cancel in-app as easily as they bought" (ROSCA).
--
-- 🔴 WHY A TABLE AND NOT JUST AN API CALL TO THE PROVIDER.
-- The merchant of record owns the buyer relationship — that is the deal [ADR 004]
-- makes and the capability register records. So the provider, not us, is what
-- ultimately stops a subscription. That creates a gap the user must never fall
-- into: between "I pressed cancel" and "the rail acted", the ONLY evidence that
-- the user asked is whatever we wrote down. Without this table, a cancellation
-- that the provider API dropped is indistinguishable from a cancellation nobody
-- ever requested — and the person still being billed is the one who has to prove
-- otherwise.
--
-- It is also what makes the flow honest TODAY. No seller account exists
-- (OWNER_QUEUE A-1, PENDING), so `executed_at` is NULL on every row this rail
-- can currently write, and the route says so in its response rather than
-- reporting a cancellation that did not happen.
--
-- APPEND-ONLY BY USE, not by constraint: one row per request, never updated
-- except to stamp `executed_at` when the rail confirms. A second press writes a
-- second row on purpose — "the user asked three times and nothing happened" is
-- exactly the fact a support conversation needs, and an upsert would erase it.
--
-- ⚠️ REPLAY. Every statement here is `IF NOT EXISTS`, so this file replays
-- cleanly; test/migrations-replay.test.ts asserts that for the whole set.
--
-- 🔒 `user_id` IS SPELLED THAT WAY DELIBERATELY. The shared erasure route
-- (services/platform/src/routes/account.ts) DERIVES the tables it empties from
-- the schema — every table carrying a column literally called `user_id` is
-- user-owned and is erased with no edit to the route. A cancellation request IS
-- a record about a person and must go when they do. (Contrast
-- `unclaimed_payments.claimed_user_id` in 0004, named to stay OUT of that set
-- for a reason recorded there.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cancellation_requests (
  -- Random UUID. A ROWID table with a surrogate text id, matching `events`
  -- (0002) rather than `entitlements` (0004): this is append-only and has no
  -- natural key — the same user may legitimately ask twice.
  request_id      TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  app_id          TEXT NOT NULL,
  -- Which money world the request was made in. Same reason as everywhere else
  -- in this rail: a sandbox request must never be read as a live one. [5]M-12.
  environment     TEXT NOT NULL,
  -- The rail and subscription the request was ABOUT, captured at request time.
  -- Copied rather than joined: the entitlement row can be revoked and rewritten
  -- afterwards, and this record has to keep saying what the user was cancelling.
  provider                 TEXT,
  provider_subscription_id TEXT,
  requested_at    TEXT NOT NULL,
  -- Stamped only when the merchant of record CONFIRMS the cancellation. NULL is
  -- the honest state today and the route reports it as `executed: false`.
  executed_at     TEXT,
  -- Why it was not executed, when it was not: `provider_not_configured` today.
  -- An enumerable code, never a raw error string — this column is read by
  -- support and by CI, not by a log search.
  not_executed_reason TEXT
);

-- Support's query is "what did this person ask for, most recent first".
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_user
  ON cancellation_requests (user_id, app_id, requested_at);
