-- ─────────────────────────────────────────────────────────────────────────────
-- 0031_privacy_requests.sql — INDIA DPDP RIGHTS REQUESTS AND NOMINEES
-- (lane dpdp-rights, O-DPDP-RIGHTS-INTAKE-UNBUILT, O-SERVER-DATA-EXPORT-MISSING).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- ADDITIVE ONLY: two new tables, CREATE ... IF NOT EXISTS, so it replays.
--
-- ── privacy_requests ─────────────────────────────────────────────────────────
-- A data principal's request to exercise a right (access, correction, erasure,
-- nomination, grievance, withdraw consent). It RIDES THE PRIVATE INTAKE: it
-- arrives on POST /v1/feedback with `kind: "privacy-request"` (src/routes/
-- feedback.ts -> src/feedback/privacy.ts), from the app's "Your privacy rights"
-- screen or nikatru.com/privacy-rights through its Pages Function.
--
--   user_id          the verified session's `sub` (a signed-in request is
--                    identified by its session: no new identifier is collected),
--                    or NULL for a signed-out requester, who proves the address
--                    by an e-mailed link first.
--   request_type     access | correction | erasure | nomination | grievance |
--                    withdraw-consent (src/feedback/privacy.ts REQUEST_TYPES).
--   details          the requester's words, PII-masked as reports are.
--   contact_email    where the answer goes: the account's address, or the one a
--                    signed-out requester proved.
--   status           unverified -> new -> acknowledged -> resolved | refused.
--                    `unverified` -> `new` ONLY by the e-mailed link; the triage
--                    routine and the cron NEVER move a rights request.
--   ack_due_at       verified_at + 48 hours (the published acknowledgement).
--   resolve_due_at   verified_at + 30 days (the published resolution).
--   statutory_due_at verified_at + 90 days for a grievance (DPDP Rules 2025, the
--                    outer limit); NULL for the other types.
--   verify_hash      SHA-256 of the one-time link's token; the token itself is
--                    never stored. Cleared once used.
--   paged_at         when the overdue page last went to the owner.
--   purge_at         created_at + 7 days while unverified; resolved_at + 400 days
--                    once closed; NULL while open, so an open request is never
--                    purged.
--
-- 🔴 `user_id`, SPELT EXACTLY (0013's rule): the erasure walk deletes a signed-in
-- requester's requests with the account.
--
-- ── privacy_nominees ─────────────────────────────────────────────────────────
-- DPDP Act s.14: ONE person the account holder names to exercise their rights if
-- they die or become incapacitated. A name and an e-mail address, nothing more.
-- The nominee is told only when they act. `user_id` PRIMARY KEY: one per account,
-- and the erasure walk deletes it with the account.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_requests (
  id                TEXT PRIMARY KEY NOT NULL,
  idempotency_key   TEXT NOT NULL,
  user_id           TEXT,
  app_id            TEXT NOT NULL,
  surface           TEXT NOT NULL,
  request_type      TEXT NOT NULL,
  details           TEXT,
  contact_email     TEXT,
  locale            TEXT,
  status            TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  verified_at       TEXT,
  ack_due_at        TEXT,
  resolve_due_at    TEXT,
  statutory_due_at  TEXT,
  acknowledged_at   TEXT,
  resolved_at       TEXT,
  status_at         TEXT,
  status_history    TEXT,
  verify_hash       TEXT,
  paged_at          TEXT,
  purge_at          TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_requests_idem ON privacy_requests (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests (status);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_verify ON privacy_requests (verify_hash);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_purge ON privacy_requests (purge_at);

CREATE TABLE IF NOT EXISTS privacy_nominees (
  user_id     TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
