-- ─────────────────────────────────────────────────────────────────────────────
-- 0013_content_reports.sql — WHERE A USER'S "THIS AI OUTPUT IS OFFENSIVE" GOES.
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- O-PLAY-AI-CONTENT-REPORTING (MASTER_PLAN G-39). Google Play's AI-Generated
-- Content policy, read 2026-09-18 at support.google.com/googleplay/android-developer/
-- answer/13985936: "Apps that generate content using AI must contain in-app user
-- reporting or flagging features that allow users to report or flag offensive
-- content to developers without needing to exit the app." A mailto: link or a
-- web form fails that sentence, so the chassis control POSTs /v1/report and the
-- report lands HERE — the record of truth. The email that follows
-- (lib/report-notify.ts) is a notice to the support inbox, not the record: it
-- can be capped, skipped or fail, and nothing is lost.
--
-- 🔴 `user_id`, SPELT EXACTLY, IS A DECISION. The erasure walk DELETES every row
-- of a table carrying a `user_id` column (services/_shared/src/erasure.ts), so a
-- reporter who deletes their account takes their reports with them — the note
-- they typed is their personal data, and a moderation queue is not a reason to
-- outlive the account. (`reporter_user_id` would have NULLed the link and kept
-- the text; that is the choice this spelling refuses.)
--
-- ⚠️ NO CHECK CONSTRAINTS, as everywhere in this directory: `reason` and `status`
-- are closed sets enforced in routes/report.ts, because a CHECK would freeze the
-- set and D1 cannot ALTER one away (0004's header records why).
--
--   reason       — REPORT_REASONS in routes/report.ts.
--   status       — open | reviewed | actioned | dismissed; written `open` here,
--                  moved by support by hand until a review surface exists.
--   notified_at  — when the support notice was ACCEPTED by Resend; NULL means no
--                  notice went out (not configured, over the daily cap, or the
--                  send failed) and the row must be found by reading this table.
--
-- RETENTION: 400 days from `created_at`, swept nightly by `retentionSweep`
-- (scheduled.ts, CONTENT_REPORTS_RETENTION_DAYS) — the platform's period for
-- personal data, clearing the DPDP Rules 2025 one-year floor. And sooner, with
-- the account, by the erasure walk.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_reports (
  id              TEXT PRIMARY KEY NOT NULL,
  user_id         TEXT NOT NULL,
  app_id          TEXT NOT NULL,
  reason          TEXT NOT NULL,
  content_ref     TEXT,
  content_excerpt TEXT,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      TEXT NOT NULL,
  notified_at     TEXT
);

-- The per-user hourly cap reads this, on every report.
CREATE INDEX IF NOT EXISTS idx_content_reports_user_created ON content_reports (user_id, created_at);
-- The global daily notice cap and the retention sweep read this.
CREATE INDEX IF NOT EXISTS idx_content_reports_created ON content_reports (created_at);
