-- ─────────────────────────────────────────────────────────────────────────────
-- 0002_analytics.sql — first-party product analytics + DPDP consent artifacts.
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- [ADR 011] product analytics = first-party (Worker /v1/events → D1), NOT
-- Firebase. This migration locks the STORAGE SHAPE only; the ingest route lands
-- with G-12. Shipping the shape first is deliberate: the envelope is
-- cheap-now/impossible-later — once rows exist, every field is a coordinated
-- migration plus a fleet of already-released clients.
--
-- SHAPE DECISIONS (do not re-litigate — see knowledge/research/39 §5):
--   • ROWID table + a UNIQUE INDEX on event_id, NOT `event_id TEXT PRIMARY KEY`.
--     A random UUID text PK gives non-sequential index locality and write
--     amplification on every insert; the rowid stays monotonic and the uniqueness
--     constraint is identical.
--   • Ingest MUST use `INSERT … ON CONFLICT(event_id) DO NOTHING`, never
--     `INSERT OR IGNORE` — OR IGNORE also silently swallows NOT NULL / CHECK / FK
--     violations, so real corruption would look like a duplicate retry.
--   • NO ip column, ever. The edge drops CF-Connecting-IP and reads coarse geo
--     from the `request.cf` object instead. That makes rows PSEUDONYMOUS, not
--     anonymous — the privacy policy must say so.
--   • `params` is JSON with ENUMERABLE VALUES ONLY: no free text, no user
--     content, no exact location. Free text in D1 cannot be retracted later.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  -- Client-generated UUIDv4. THE idempotency key: retries of a queued batch are
  -- inherently at-least-once, so the sink must be exactly-once.
  event_id     TEXT NOT NULL,
  app_id       TEXT NOT NULL,
  -- Pseudonymous per-install id. MUST be the SAME value the client uses for
  -- feature-flag bucketing (the brick's installIdProvider) — two independent ids
  -- would make every %-rollout permanently unmeasurable. Never a device ad-ID.
  anon_id      TEXT NOT NULL,
  -- Rotates after ~30 min idle.
  session_id   TEXT,
  -- ios | android | web | macos | windows | linux
  platform     TEXT,
  app_version  TEXT,
  event        TEXT NOT NULL,
  params       TEXT NOT NULL DEFAULT '{}',
  -- Client clock: UNTRUSTED (skewed, offline-queued, user-settable).
  client_ts    TEXT,
  -- Edge receipt time: the authoritative ordering/cohort clock.
  server_ts    TEXT NOT NULL,
  -- Coarse geo from `request.cf` — country/region/city only, never an IP.
  country      TEXT,
  region       TEXT,
  city         TEXT,
  -- The consent artifact in force when this event was collected (DPDP §6(3): a
  -- withdrawal has to be able to reference what was consented to).
  consent_id   TEXT
);

-- The idempotency guarantee. Exists BEFORE the first row lands so no duplicate
-- can ever be admitted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON events (event_id);
-- Portfolio + per-app time-series reads (the ~5 dashboard numbers).
CREATE INDEX IF NOT EXISTS idx_events_app_ts       ON events (app_id, server_ts);
CREATE INDEX IF NOT EXISTS idx_events_app_evt_ts   ON events (app_id, event, server_ts);
-- Funnel/retention: one install's ordered event stream.
CREATE INDEX IF NOT EXISTS idx_events_app_anon_ts  ON events (app_id, anon_id, server_ts);

-- ─────────────────────────────────────────────────────────────────────────────
-- Consent artifacts (DPDP). One row per grant/withdrawal decision, append-only:
-- a withdrawal is a NEW row with granted=0, never an UPDATE — the audit trail is
-- the point. Deliberately carries NO IP and NO device fingerprint.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_artifacts (
  consent_id     TEXT NOT NULL,      -- client-generated UUIDv4 (idempotency key)
  app_id         TEXT NOT NULL,
  anon_id        TEXT NOT NULL,      -- same pseudonymous per-install id
  purpose        TEXT NOT NULL,      -- 'analytics' | 'sync_backup' | …
  granted        INTEGER NOT NULL,   -- 1 = granted, 0 = withdrawn
  policy_version TEXT NOT NULL,      -- which privacy policy was shown
  app_version    TEXT,
  platform       TEXT,
  client_ts      TEXT,
  server_ts      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_id ON consent_artifacts (consent_id);
-- "what is this install's current consent for purpose X" = newest row.
CREATE INDEX IF NOT EXISTS idx_consent_lookup
  ON consent_artifacts (app_id, anon_id, purpose, server_ts);
