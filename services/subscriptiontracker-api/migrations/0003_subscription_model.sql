-- ─────────────────────────────────────────────────────────────────────────────
-- 0003_subscription_model.sql — the model can describe a subscription
-- ([ADR 077] §5, owner-approved 2026-09-11; train ST-T3a, labels ST-M1 + ST-M2).
-- Applies to APP_DB (subscriptiontracker_db):
--   wrangler d1 migrations apply APP_DB --local   (or --remote)
--
-- Before this file the row had no currency, no cadence beyond monthly/yearly,
-- no trial, no lifecycle status, no rail, no cancel URL, no per-subscription
-- reminder and no price history. The client has sent `currency` and
-- `price_minor` since ST-T1 and the Worker dropped both, so every row read back
-- in the client's fallback currency.
--
-- STRICTLY ADDITIVE, like 0002: no DROP, no RENAME, no type change, no table
-- rebuild (tooling/ci/check-migrations.mjs bans all four with no escape hatch).
--
-- 🔴 WHAT [ADR 077] §5.3 MAKES THIS FILE DO, AND NOT DO.
--   · `used_pct`, `usage_note` and `unused` stay. They are DEPRECATED, never
--     dropped (INV-06-27); retiring their readers is app work (ST-E*), not SQL.
--   · `cycle` keeps `CHECK (cycle IN ('monthly','yearly'))` forever, because
--     SQLite cannot alter a CHECK without a rebuild. So the cadence lives in
--     `cycle_every` + `cycle_unit`, and the route keeps `cycle` equal to the
--     legacy value the pair means ('monthly' for 1 month, 'yearly' for 1 year,
--     NULL for anything else). The platform Worker's nightly renewals fan-out
--     (services/platform/src/renewals.ts) reads only `cycle` and skips NULL, so
--     a weekly row is left alone instead of being rolled forward a month.
--   · NO CHECK ON ANY NEW COLUMN. The same rule would freeze every closed set
--     below (`status`, `rail`, `cycle_unit`) at today's members. The route
--     validates them (src/routes/subscriptions.ts `validate`), where a new
--     member is a code change and not a table rebuild.
--
-- ⚠️ TWO NAMES DIFFER FROM [ADR 077] §5.1's list, on purpose:
--   · §5.1's `amount` is `price_minor` here. `price` (REAL) already holds the
--     amount; the client has sent the exact integer as `price_minor` since
--     ST-T1 (apps/subscriptiontracker/lib/data/models/subscription.dart
--     `toJson`), and a third name for the same money would be a third thing to
--     keep in step.
--   · §5.1's `next_charge_on` is not added. `next_renewal` already IS the next
--     charge date: /v1/renewals and the platform fan-out read it. Two columns
--     for one date is how they come apart.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── subscriptions: money ────────────────────────────────────────────────────
-- ISO 4217, upper case. NULL on every row that exists today, and deliberately
-- NOT defaulted to 'USD': those rows were typed in the user's own currency, and
-- a stored 'USD' would outrank the client's decode fallback to that currency
-- (Subscription.readPrice prefers the wire value), turning today's display bug
-- into a stored one.
--
-- THE BACKFILL "FROM THE USER'S CURRENCY WHERE KNOWN" HAS NO SOURCE IN SQL, and
-- that was measured, not assumed: no table in this database carries a user's
-- currency (`budgets` is user_id, monthly_budget, updated_at), and a D1
-- migration cannot read platform_db. The user's currency lives on the device
-- (Settings), so the rows get it from the client: every create sends
-- `currency`, and an edit that sends it stamps a legacy row. Until then the
-- client decodes a NULL currency with the user's currency (ST-C1), which stays.
ALTER TABLE subscriptions ADD COLUMN currency TEXT;
-- The charge as an exact count of the currency's minor unit. `price` stays and
-- stays written: the fan-out copies it into payment_history, and every client
-- before ST-T1 reads only it.
ALTER TABLE subscriptions ADD COLUMN price_minor INTEGER;

-- ── subscriptions: cadence ──────────────────────────────────────────────────
ALTER TABLE subscriptions ADD COLUMN cycle_every INTEGER;  -- 1.. ; with cycle_unit
ALTER TABLE subscriptions ADD COLUMN cycle_unit TEXT;      -- day|week|month|year
ALTER TABLE subscriptions ADD COLUMN first_charge_on TEXT; -- 'YYYY-MM-DD'

-- ── subscriptions: lifecycle ────────────────────────────────────────────────
-- NOT NULL with a constant DEFAULT is the one NOT NULL an ADD COLUMN may carry,
-- and it is what keeps today's rows valid: each reads as `active`.
ALTER TABLE subscriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'; -- active|trialing|paused|cancelled
ALTER TABLE subscriptions ADD COLUMN trial_ends_on TEXT;   -- 'YYYY-MM-DD'
ALTER TABLE subscriptions ADD COLUMN cancelled_on TEXT;    -- 'YYYY-MM-DD'
ALTER TABLE subscriptions ADD COLUMN deleted_at TEXT;      -- ISO-8601 instant; soft delete

-- ── subscriptions: what the user knows about it ─────────────────────────────
ALTER TABLE subscriptions ADD COLUMN notes TEXT;
ALTER TABLE subscriptions ADD COLUMN service_id TEXT;      -- catalogue key
ALTER TABLE subscriptions ADD COLUMN cancel_url TEXT;      -- http(s) only
-- How the charge reaches the user ([ADR 077] §7: not how WE are paid).
ALTER TABLE subscriptions ADD COLUMN rail TEXT;            -- upi_autopay|card_emandate|nach|app_store|play|paypal|manual|unknown
ALTER TABLE subscriptions ADD COLUMN rail_holder TEXT;     -- user-typed label, never read from a bank
-- JSON list of days before the charge, e.g. '[7,1]'. NULL = the account default.
ALTER TABLE subscriptions ADD COLUMN reminder_days TEXT;

-- ── subscriptions: sharing ──────────────────────────────────────────────────
ALTER TABLE subscriptions ADD COLUMN shared_with TEXT;     -- a label, not an account
ALTER TABLE subscriptions ADD COLUMN share_numerator INTEGER NOT NULL DEFAULT 1;
ALTER TABLE subscriptions ADD COLUMN share_denominator INTEGER NOT NULL DEFAULT 1;

-- ── backfill: the cadence today's rows already have ─────────────────────────
-- Every existing row with a `cycle` gets the pair that cycle means, so a new
-- reader never has to fall back to the legacy column. Idempotent: the WHERE
-- matches nothing on a second run.
UPDATE subscriptions
   SET cycle_every = 1, cycle_unit = 'month'
 WHERE cycle = 'monthly' AND cycle_unit IS NULL;
UPDATE subscriptions
   SET cycle_every = 1, cycle_unit = 'year'
 WHERE cycle = 'yearly' AND cycle_unit IS NULL;

-- ── price_change: the one genuinely new table ([ADR 077] §5.2) ──────────────
-- `id` and `updated_at` from the start, so it never needs 0002's repair.
-- `user_id` makes it user-owned: DELETE /v1/account derives its sweep from the
-- `user_id` column (src/lib/erase-subject.ts), so erasure reaches it with no
-- list to extend. Amounts are exact minor units, named as `price_minor` is.
CREATE TABLE IF NOT EXISTS price_change (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT,
  user_id          TEXT,
  effective_on     TEXT,             -- 'YYYY-MM-DD'
  old_amount_minor INTEGER,
  new_amount_minor INTEGER,
  currency         TEXT,
  created_at       TEXT,
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_price_change_user
  ON price_change (user_id);
CREATE INDEX IF NOT EXISTS idx_price_change_subscription
  ON price_change (subscription_id, effective_on);

-- ── payment_history: extended, not created ([ADR 077] §5.2) ─────────────────
-- Both NULL on existing rows and on rows the fan-out writes: it names its
-- columns and knows neither yet. NULL currency decodes as the user's currency
-- in the client (PaymentRecord.fromJson), exactly as today.
ALTER TABLE payment_history ADD COLUMN currency TEXT;
ALTER TABLE payment_history ADD COLUMN source TEXT;       -- who recorded it, e.g. renewal|manual
