-- ─────────────────────────────────────────────────────────────────────────────
-- 0028_refund_requests.sql — EVERY IN-WINDOW REFUND A USER ASKED FOR, AND WHAT
-- BECAME OF IT (refund-finish, MF-5; O-REFUND-IN-WINDOW-UNAUTOMATED).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- The policy is the page: sites/nikatru/refund.html (owner copy, ADR 031 class
-- B; ADR 100). A request within 30 days of the charge is refunded in full, no
-- reason needed, through the rail that took the money; a store purchase is the
-- store's to refund. POST /v1/plan/refund (src/routes/refund.ts) writes one row
-- per request — the money event — and carries it out through the payments
-- port's `refund` where the rail declares it; otherwise the row is the prepared
-- manual case tooling/ops/refund.mjs builds from (`not_executed_reason`).
--
-- 🔴 ONE REFUND PER PAYMENT: UNIQUE (provider, purchase_ref). A second request
-- for the same charge answers the first one's record, never a second refund.
-- 🔴 IDEMPOTENT PER REQUEST: UNIQUE (user_id, idempotency_key) — a retried POST
-- with the same Idempotency-Key reads its own row back.
-- 🔴 REFERENCES ONLY: the rail's purchase and refund references, never a card,
-- UPI or bank detail. `user_id`, SPELT EXACTLY, so the erasure walk deletes a
-- person's requests with the account.
-- 🔴 ISO-8601 TEXT for every instant (0017's header). No CHECK constraints
-- (0004's header): `not_executed_reason` is the closed set of routes/refund.ts.
--
-- REPLAY: CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only, so the file
-- re-applies and is in REPLAY_SAFE_MIGRATIONS (test/harness.ts).
--
-- RETENTION: kept for the life of the account (a refund is a money event a
-- dispute or an audit can ask about), erased with it (tooling/ops/register.json
-- retention.d1.platform_db.refund_requests).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refund_requests (
  request_id          TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  app_id              TEXT NOT NULL,
  environment         TEXT NOT NULL,
  provider            TEXT NOT NULL,
  -- The rail's purchase (transaction / payment) reference the refund is FOR.
  purchase_ref        TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  -- When the charge happened, as the first signed notification naming it says;
  -- NULL when no stored notification names it (then nothing was refunded here).
  charged_at          TEXT,
  requested_at        TEXT NOT NULL,
  -- Stamped only when the rail CONFIRMED the refund.
  executed_at         TEXT,
  refund_ref          TEXT,
  not_executed_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_purchase
  ON refund_requests (provider, purchase_ref);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_idem
  ON refund_requests (user_id, idempotency_key);
