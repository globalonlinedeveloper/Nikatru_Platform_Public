-- ─────────────────────────────────────────────────────────────────────────────
-- 0025_feedback.sql — WHERE "REPORT A PROBLEM" GOES (lane feedback-intake,
-- O-FEEDBACK-INTAKE-UNBUILT, O-FEEDBACK-HAS-NO-DIAGNOSTICS).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- WRITTEN BY THIS WORKER: POST /v1/feedback (src/routes/feedback.ts), its
-- status moves (src/routes/feedback-ops.ts) and the nightly limbs
-- (src/feedback/cron.ts). platform_db is the portfolio's APAC database
-- (C-APAC-RESIDENCY), so the reports are in APAC without a second database whose
-- id would have to be committed before it exists.
--
-- 🔴 `user_id`, SPELT EXACTLY, IS A DECISION (0013's rule): the erasure walk
-- (services/_shared/src/erasure.ts) DELETES every row of a table carrying a
-- `user_id` column, so DELETE /v1/account takes a signed-in reporter's reports
-- with it. An anonymous report has `user_id` NULL and is reached by its 90-day
-- purge only. The screenshot object a deleted row pointed at is removed by the
-- platform Worker's nightly feedback orphan sweep (src/feedback/cron.ts).
--
-- ⚠️ NO CHECK CONSTRAINTS, as everywhere in this directory: `category`,
-- `surface` and `status` are closed sets enforced in src/feedback/.
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
--   contact_email    ONLY when "you may reply to me" or "tell me when it is
--                    fixed" was ticked: the account's address, or the one typed
--                    while signed out. NULL otherwise.
--   notify_fixed     1 when "tell me when it is fixed" was ticked.
--   screenshot_key   the private bucket key, or NULL.
--   purge_at         created_at + 90 days; the feedback Worker's cron deletes
--                    the row and its screenshot at this instant.
--   status           the lifecycle (lane feedback-triage), services/platform/src/feedback/lifecycle.ts:
--                    new -> triaged -> duplicate | known | in-fix -> fixed -> notified,
--                    plus wontfix and spam. Moved ONLY by POST /v1/ops/feedback/move
--                    (the triage tool) and, fixed -> notified, by the Worker's cron.
--   status_at,       when the status last moved, and every move as JSON
--   status_history   [{"from","to","at","by"}]; deleted with the row.
--   duplicate_of     the FB- id a `duplicate` points at.
--   fix_pr           the fix PR's number (`in-fix`); its commits carry
--                    `Fixes-Report: FB-<id>` trailers.
--   fixed_version    the release that carries the fix (`fixed`).
--   receipt_at,      when the one receipt / the one "fixed in" notice was
--   notified_at      CLAIMED (claim-then-send: a lost answer never mails twice).
--   unsubscribe_hash SHA-256 of the one-click unsubscribe token the notice
--                    carried; the token itself is never stored.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feedback_reports (
  id               TEXT PRIMARY KEY NOT NULL,
  idempotency_key  TEXT NOT NULL,
  user_id          TEXT,
  app_id           TEXT NOT NULL,
  reported_version      TEXT,
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
  purge_at         TEXT NOT NULL,
  status_at        TEXT,
  status_history   TEXT,
  duplicate_of     TEXT,
  fix_pr           INTEGER,
  fixed_version    TEXT,
  receipt_at       TEXT,
  notified_at      TEXT,
  unsubscribe_hash TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_reports_idem ON feedback_reports (idempotency_key);
-- The nightly purge reads this.
CREATE INDEX IF NOT EXISTS idx_feedback_reports_purge ON feedback_reports (purge_at);

-- The notice cron reads the reports waiting for their "fixed in" mail.
CREATE INDEX IF NOT EXISTS idx_feedback_reports_status ON feedback_reports (status);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_unsubscribe ON feedback_reports (unsubscribe_hash);

-- Addresses that pressed "unsubscribe" on a feedback mail (lane feedback-triage):
-- SHA-256 of the lower-cased address, never the address. No `user_id`, so the
-- erasure walk leaves it: a suppression outlives the reports, which is its whole
-- point — an address that said stop is never mailed by this Worker again.
CREATE TABLE IF NOT EXISTS feedback_mail_suppressed (
  address_hash TEXT PRIMARY KEY NOT NULL,
  created_at   TEXT NOT NULL
);

-- The anonymised stub a purged report leaves for counts: no text, no account,
-- no contact, no screenshot, no date finer than the day. One row per
-- (day, app, version, category, status), counted.
CREATE TABLE IF NOT EXISTS feedback_counts (
  day          TEXT NOT NULL,
  app_id       TEXT NOT NULL,
  reported_version  TEXT NOT NULL,
  category     TEXT NOT NULL,
  status       TEXT NOT NULL,
  n            INTEGER NOT NULL,
  PRIMARY KEY (day, app_id, reported_version, category, status)
);

-- The intake's hour windows (services/platform/src/feedback/window-limiter.ts). A
-- `key_hash` is SHA-256 of a per-window random salt and the caller key (a user id,
-- or the Cloudflare colo and ASN of a signed-out request — never an address, which
-- no Worker reads), truncated to 16 hex (C-NO-NETWORK-ADDRESS-COLUMN). The salt row
-- is deleted with its window, after which no hash can be recomputed from any key.
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
