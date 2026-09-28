-- ─────────────────────────────────────────────────────────────────────────────
-- 0020_reminders.sql — RENEWAL REMINDERS THAT REACH EVERY TARGET: an email
-- digest from the nightly scheduler (ST-R1) and a private calendar feed any
-- calendar can subscribe to by URL (ST-R2).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- Web is the one live target and no reminder of any kind reached it: the
-- in-app notification is a device feature. An email and a calendar event reach
-- every target, web included, so both are built here, on the platform Worker,
-- once for the portfolio.
--
--   reminder_prefs — one row per (account, app): has the person opted in to the
--                    email digest, and how many days ahead. Written only by
--                    PUT /v1/reminders/prefs (routes/reminders.ts). NO ROW is
--                    "not opted in": nobody is mailed until they ask.
--   reminder_sent  — one row per mail-worthy fact already mailed: (account, app,
--                    subscription, due date, kind). The UNIQUE constraint is
--                    what makes "a night never mails twice" a property of the
--                    database rather than of the job's memory — a re-run, a
--                    retried cron or two overlapping firings all collide here.
--   reminder_feed  — one row per (account, app) calendar feed. Only SHA-256 of
--                    the feed token is stored; the token is returned ONCE by
--                    POST /v1/calendar/feed and never written anywhere. A
--                    rotation replaces the hash in place; DELETE sets revoked_at.
--
-- 🔴 NO EMAIL ADDRESS IS STORED, ANYWHERE IN THIS FILE. The address is read at
-- send time from the identity provider (confirmed addresses only), so an
-- address change or an unconfirmed address is honoured the same night, and
-- the address never lands in platform_db, which is meant to hold account ids,
-- not the directly-identifying value behind them (lib/reminders.ts;
-- test/reminder-mail.test.ts reads the ledger back for it).
--
-- 🔴 `user_id`, SPELT EXACTLY, IS A DECISION (as in 0013 and 0017): the erasure
-- walk DELETES every row of a table carrying a `user_id` column
-- (services/_shared/src/erasure.ts), so erasing the account removes the
-- preference, the sent ledger and the feed — and a deleted feed row answers
-- the same 404 as a token that never existed.
--
-- 🔴 EVERY TIMESTAMP IS ISO-8601 TEXT and every date is 'YYYY-MM-DD' TEXT,
-- never an integer: SQLite sorts every INTEGER below every TEXT (see 0017).
--
-- ⚠️ NO CHECK CONSTRAINTS, as everywhere in this directory: `lead_days` is
-- bounded and `kind` is a closed set, both enforced in code.
--
-- REPLAY: CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only, so the file
-- re-applies cleanly and is listed in REPLAY_SAFE_MIGRATIONS (test/harness.ts).
--
-- RETENTION (tooling/ops/register.json retention.d1.platform_db.*): a
-- preference and a feed are kept while the account lives (at most one row per
-- account and app); a `reminder_sent` row is pruned by the reminder job itself
-- REMINDER_SENT_RETENTION_DAYS after its `due_on`.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reminder_prefs (
  user_id      TEXT NOT NULL,
  app_id       TEXT NOT NULL,
  email_opt_in INTEGER NOT NULL DEFAULT 0,
  lead_days    INTEGER NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);

-- The nightly job reads the opted-in accounts of one app at a time.
CREATE INDEX IF NOT EXISTS idx_reminder_prefs_app_opt_in ON reminder_prefs (app_id, email_opt_in);

-- `unsubscribe_hash` is SHA-256 of the one-click unsubscribe token that digest's
-- List-Unsubscribe header carries. Every row of one digest shares it, so the
-- token names (account, app) without the address or the account id being in the
-- link, and a stored hash cannot be turned back into a working link.
CREATE TABLE IF NOT EXISTS reminder_sent (
  user_id          TEXT NOT NULL,
  app_id           TEXT NOT NULL,
  subscription_id  TEXT NOT NULL,
  due_on           TEXT NOT NULL,
  kind             TEXT NOT NULL,
  sent_at          TEXT NOT NULL,
  unsubscribe_hash TEXT NOT NULL,
  UNIQUE (user_id, app_id, subscription_id, due_on, kind)
);

-- The daily cap counts today's digests, the prune deletes by `due_on`, and the
-- one-click unsubscribe looks its token up by hash.
CREATE INDEX IF NOT EXISTS idx_reminder_sent_sent_at ON reminder_sent (sent_at);
CREATE INDEX IF NOT EXISTS idx_reminder_sent_due_on ON reminder_sent (due_on);
CREATE INDEX IF NOT EXISTS idx_reminder_sent_unsubscribe ON reminder_sent (unsubscribe_hash);

CREATE TABLE IF NOT EXISTS reminder_feed (
  user_id    TEXT NOT NULL,
  app_id     TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (user_id, app_id)
);

-- Every public feed fetch looks its token up by this, and a hash names one feed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_feed_token_hash ON reminder_feed (token_hash);
