-- ─────────────────────────────────────────────────────────────────────────────
-- 0025_provider_payment_links.sql — A RAZORPAY REFUND OR DISPUTE FINDS ITS
-- SUBSCRIPTION BY THE PAYMENT IT REVERSES (PR #1149, lead ruling item 2,
-- option b, 2026-10-02; O-RAZORPAY-CHECKOUT-ADAPTER).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- 🔴 WHY A MAP. A Razorpay refund or dispute names a PAYMENT (`payment_id`), and
-- the store finds the account by SUBSCRIPTION. Whether the payment entity on a
-- refund carries `subscription_id` is unconfirmed (the docs' payment entity
-- names `invoice_id`; src/lib/mor/razorpay.ts header). `subscription.charged`
-- carries both the subscription and the payment it charged, signed, so the store
-- writes `payment id → subscription id` THERE, once, and an adjustment resolves
-- its subscription by its payment id — independent of the payment entity's own
-- fields (src/lib/mor/store.ts `linkPayment` / `subscriptionOfPayment`).
--
-- FIRST LINK WINS: a payment belongs to exactly one subscription, so the insert
-- is `ON CONFLICT (provider, provider_payment_id) DO NOTHING`.
--
-- 🔴 ISO-8601 TEXT, NEVER INTEGER (0017's header records why).
-- 🔴 `user_id`, SPELT EXACTLY: the erasure walk deletes a buyer's links with the
-- account. NULL when the charge resolved no account (an unclaimed payment).
--
-- REPLAY: CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only, so the file
-- re-applies and is in REPLAY_SAFE_MIGRATIONS (test/harness.ts).
--
-- RETENTION: one row per subscription charge on a payment-linked rail; it lives
-- as long as a refund or chargeback of that payment can arrive, and leaves with
-- the account on erasure (tooling/ops/register.json
-- retention.d1.platform_db.provider_payment_links).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS provider_payment_links (
  provider                 TEXT NOT NULL,
  provider_payment_id      TEXT NOT NULL,
  provider_subscription_id TEXT NOT NULL,
  user_id                  TEXT,
  environment              TEXT NOT NULL,
  linked_at                TEXT NOT NULL,
  -- The signed notification that carried both ids: "why do we believe this
  -- payment belongs to this subscription" has one answer.
  linked_from_event_id     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_payment_links_payment
  ON provider_payment_links (provider, provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_provider_payment_links_user
  ON provider_payment_links (user_id);
