-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_signups.sql — THE nikatru.com LAUNCH-NOTIFICATION LIST, IN APAC.
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- [ADR 087] (owner, 2026-09-15, "Move to D1 in APAC (Recommended)", amended §4
-- "List to D1, counter stays (Recommended)"). The list leaves the Workers KV
-- namespace `nikatru-signups`, which has no location control, for this table in
-- platform_db (served from SIN). The only writer is the Pages Function
-- sites/nikatru/functions/api/subscribe.js, through the Pages project's
-- production D1 binding `PLATFORM_DB`. The `rl:` rate-limit counter STAYS in KV.
--
-- 🔴 TWO COLUMNS, AND THAT IS A PUBLISHED PROMISE, NOT A SCHEMA PREFERENCE.
-- sites/nikatru/privacy.html says "We store your email address and the time you
-- signed up, and nothing else", and subscribe.js quotes it as its SITE PROMISE.
-- A third column — a source, a build marker, an IP-derived anything — makes that
-- page false. That is also why this table carries no provenance marker column:
-- tooling/prod-provenance.json attributes its rows with a resolver computed from
-- `email` inside D1, returning counts only.
--
-- `email` is the address as submitted. It is the PRIMARY KEY with COLLATE NOCASE,
-- so a repeat signup in a different letter case is the SAME row — the KV store
-- keyed `sub:<lowercased email>` for the same reason. A repeat signup writes
-- nothing (INSERT … ON CONFLICT DO NOTHING), so `signed_up_at` stays the ORIGINAL
-- signup time.
--
-- RETENTION: 400 days from `signed_up_at`, deleted by the nightly
-- `retentionSweep` in services/platform/src/scheduled.ts (SIGNUPS_RETENTION_DAYS).
-- Rows migrated from KV carry their ORIGINAL signup time, so the two KV keys that
-- never had an expiry are bounded by the same period as every new row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signups (
  email         TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
  signed_up_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signups_signed_up_at ON signups (signed_up_at);
