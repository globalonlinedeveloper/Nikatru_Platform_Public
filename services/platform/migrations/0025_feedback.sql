-- ─────────────────────────────────────────────────────────────────────────────
-- 0025_feedback.sql — WHERE "REPORT A PROBLEM" GOES (lane feedback-intake,
-- O-FEEDBACK-INTAKE-UNBUILT, O-FEEDBACK-HAS-NO-DIAGNOSTICS).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- WRITTEN BY services/feedback, NOT BY THIS WORKER. The feedback Worker binds
-- platform_db as PLATFORM_DB without a migrations_dir (the clone contract: the
-- platform is the sole applier), the way services/subscriptiontracker-api binds
-- it for entitlements. platform_db is the portfolio's APAC database
-- (C-APAC-RESIDENCY), so the reports are in APAC without a second database whose
-- id would have to be committed before it exists.
--
-- 🔴 `user_id`, SPELT EXACTLY, IS A DECISION (0013's rule): the erasure walk
-- (services/_shared/src/erasure.ts) DELETES every row of a table carrying a
-- `user_id` column, so DELETE /v1/account takes a signed-in reporter's reports
-- with it. An anonymous report has `user_id` NULL and is reached by its 90-day
-- purge only. The screenshot object a deleted row pointed at is removed by the
-- feedback Worker's nightly orphan sweep (services/feedback/src/scheduled.ts).
--
-- ⚠️ NO CHECK CONSTRAINTS, as everywhere in this directory: `category`,
-- `surface` and `status` are closed sets enforced in services/feedback/src.
--
--   id               'FB-' + 10 base32 characters, the id a reporter is told.
--   idempotency_key  the client's key: an offline report replayed by the outbox
--                    is answered with its first id, never stored twice.
--   user_id          the verified token's `sub`, or NULL (signed out, a site
--                    form, an extension without an account).
--   description,     the user's words, PII-masked before storage (e-mail
--   steps            addresses, phone numbers, card-like and UPI-id-like strings).
--   diagnostics      JSON the client showed in its preview: app version, build,
--                    channel, platform, OS version, device class, locale, text
--                    scale, theme, the last error CODES, the crash event id (only
--                    with crash-reporting consent), and `logs` only on opt-in.
--   contact_email    ONLY when "you may reply to me" was ticked: the account's
--                    address, or the one typed while signed out. NULL otherwise.
--   notify_fixed     1 when "tell me when it is fixed" was ticked.
--   screenshot_key   the private bucket key, or NULL.
--   purge_at         created_at + 90 days; the feedback Worker's cron deletes
--                    the row and its screenshot at this instant.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feedback_reports (
  id               TEXT PRIMARY KEY NOT NULL,
  idempotency_key  TEXT NOT NULL,
  user_id          TEXT,
  app_id           TEXT NOT NULL,
  app_version      TEXT,
  surface          TEXT NOT NULL,
  category         TEXT NOT NULL,
  description      TEXT NOT NULL,
  steps            TEXT,
  diagnostics      TEXT,
  contact_email    TEXT,
  reply_ok         INTEGER NOT NULL DEFAULT 0,
  notify_fixed     INTEGER NOT NULL DEFAULT 0,
  screenshot_key   TEXT,
  status           TEXT NOT NULL DEFAULT 'new',
  created_at       TEXT NOT NULL,
  purge_at         TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_reports_idem ON feedback_reports (idempotency_key);
-- The nightly purge reads this.
CREATE INDEX IF NOT EXISTS idx_feedback_reports_purge ON feedback_reports (purge_at);

-- The anonymised stub a purged report leaves for counts: no text, no account,
-- no contact, no screenshot, no date finer than the day. One row per
-- (day, app, version, category, status), counted.
CREATE TABLE IF NOT EXISTS feedback_counts (
  day          TEXT NOT NULL,
  app_id       TEXT NOT NULL,
  app_version  TEXT NOT NULL,
  category     TEXT NOT NULL,
  status       TEXT NOT NULL,
  n            INTEGER NOT NULL,
  PRIMARY KEY (day, app_id, app_version, category, status)
);

-- The intake's hour windows (services/feedback/src/lib/window-limiter.ts). A
-- `key_hash` is SHA-256 of a per-window random salt and the caller key (a user id
-- or the client address), truncated to 16 hex; the address itself is never
-- written (C-NO-NETWORK-ADDRESS-COLUMN). The salt row is deleted with its window,
-- after which no hash can be recomputed from any address.
CREATE TABLE IF NOT EXISTS feedback_rate_windows (
  window_start INTEGER NOT NULL,
  key_hash     TEXT NOT NULL,
  n            INTEGER NOT NULL,
  PRIMARY KEY (window_start, key_hash)
);
CREATE TABLE IF NOT EXISTS feedback_rate_salts (
  window_start INTEGER PRIMARY KEY NOT NULL,
  salt         TEXT NOT NULL
);
