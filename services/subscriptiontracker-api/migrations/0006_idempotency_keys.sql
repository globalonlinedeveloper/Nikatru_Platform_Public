-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_idempotency_keys.sql — the Idempotency-Key ledger for POST
-- /v1/subscriptions (AB-O2-02; lead ruling on #1075, review findings 5 and 6).
-- Applies to APP_DB (subscriptiontracker_db):
--   wrangler d1 migrations apply APP_DB --local   (or --remote)
--
-- One row per (user, key) a keyed create has claimed:
--   · body_hash — SHA-256 of the canonical request body. A reused key whose
--     body hashes differently is a 422, never a silent "here is the first row".
--   · row_id    — the subscription the key made. The row outlives a DELETE of
--     that subscription, so a late replay is answered, never re-created: it is
--     the tombstone.
--   · state     — 'pending' while the claiming request runs, 'done' after. A
--     second attempt that finds 'pending' is told 409 (in progress) instead of
--     racing the first to an insert.
--
-- STRICTLY ADDITIVE: one new table, nothing altered (tooling/ci/check-migrations
-- bans DROP/RENAME/type change/rebuild). Erasure needs no code: the table has a
-- `user_id` column, so services/_shared/src/erasure.ts derives it as a target.
--
-- DEPLOY: apply before the Worker that names the table (api → web).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  body_hash  TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'done'; no CHECK, 0003's reason: only lib/idempotency.ts writes it
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
