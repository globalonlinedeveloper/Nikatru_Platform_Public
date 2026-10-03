-- ─────────────────────────────────────────────────────────────────────────────
-- 0026_ai_meter.sql — THE AI METER: WHO HAS PAID FOR HOW MANY AI CALLS, AND WHAT
-- EVERY CALL COST (train-st-ai-customer-pays, T17, AI-01).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- 🔴 CUSTOMER PAYS (owner lock 2026-10-01: "If using AI ... it should come from
-- customer pocket"). No row here is ever created with a free credit: a credit
-- comes from a PAID plan's monthly allowance (never during a trial) or from a
-- VERIFIED pack purchase (`ai_ledger` kind `grant`). src/lib/ai/meter.ts is the
-- only writer; it RESERVES one credit before any model call (the port's
-- `beforeCall`, services/_shared/src/ports/ai.ts) and SETTLES after it.
--
--   ai_accounts — one row per (user, app): the paid pack credits left, the
--                 allowance used in the current UTC month, and the AI opt-in
--                 (the disclosure version the user acknowledged, and when). No
--                 opt-in, no call (routes/ai.ts).
--   ai_ledger   — one row per CALL (kind `call`: its reservation, then its
--                 settlement — tokens and USD at the model's own prices) and
--                 one per pack GRANT (kind `grant`: the rail and its purchase
--                 reference, UNIQUE, so a replayed webhook credits once). The
--                 global daily spend circuit-breaker sums this table.
--
-- 🔴 NO CONTENT. Neither table holds a prompt, an image, an e-mail or a model
-- answer — the request body is never persisted (routes/ai.ts, its test proves
-- it). Tokens, USD, ids and timestamps only.
--
-- 🔴 `user_id`, SPELT EXACTLY: the erasure walk deletes both tables' rows with
-- the account (services/_shared/src/erasure.ts).
--
-- 🔴 ISO-8601 TEXT, NEVER INTEGER, for every instant (0017's header records why).
-- ⚠️ NO CHECK CONSTRAINTS (0004's header): `kind`, `source` and `status` are the
-- closed sets of src/lib/ai/meter.ts.
--
-- ADDITIVE ONLY and deployed ALONE, first: the routes tolerate the tables being
-- absent (a missing table is a refused reservation, never a free call).
--
-- REPLAY: CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only, so the file
-- re-applies and is in REPLAY_SAFE_MIGRATIONS (test/harness.ts).
--
-- RETENTION: both are kept for the life of the account (a credit balance and the
-- ledger that explains it are what a customer paid for) and leave with it on
-- erasure (tooling/ops/register.json retention.d1.platform_db.ai_accounts,
-- retention.d1.platform_db.ai_ledger).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_accounts (
  user_id            TEXT NOT NULL,
  app_id             TEXT NOT NULL,
  -- Paid pack credits left. Never negative: every debit is `WHERE pack_credits > 0`.
  pack_credits       INTEGER NOT NULL DEFAULT 0,
  -- The UTC month (YYYY-MM) `allowance_used` counts; a new month starts at 0.
  allowance_period   TEXT,
  allowance_used     INTEGER NOT NULL DEFAULT 0,
  -- The AI disclosure the user acknowledged (its version) and when. NULL: no opt-in.
  consent_version    TEXT,
  consent_at         TEXT,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);

CREATE TABLE IF NOT EXISTS ai_ledger (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL,
  user_id            TEXT,
  app_id             TEXT NOT NULL,
  environment        TEXT NOT NULL,
  -- call: the feature and the model asked for; grant: NULL.
  feature            TEXT,
  model              TEXT,
  -- call: where its credit came from (allowance | pack); grant: pack.
  source             TEXT NOT NULL,
  -- call: -1 while reserved or settled, 0 once released; grant: the credits bought.
  credits            INTEGER NOT NULL,
  -- call: reserved | settled | released | refused; grant: granted | revoked.
  status             TEXT NOT NULL,
  reserved_usd       REAL NOT NULL DEFAULT 0,
  cost_usd           REAL,
  tokens_in          INTEGER,
  tokens_out         INTEGER,
  -- grant: the rail and its purchase reference — the idempotency key.
  provider           TEXT,
  provider_ref       TEXT,
  created_at         TEXT NOT NULL,
  -- The UTC day (YYYY-MM-DD) of `created_at`: the global and per-user daily caps sum by it.
  day                TEXT NOT NULL,
  settled_at         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_ledger_grant
  ON ai_ledger (provider, provider_ref);
CREATE INDEX IF NOT EXISTS idx_ai_ledger_day
  ON ai_ledger (day, kind);
CREATE INDEX IF NOT EXISTS idx_ai_ledger_user
  ON ai_ledger (user_id, app_id, day);
