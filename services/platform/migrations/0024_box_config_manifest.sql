-- ─────────────────────────────────────────────────────────────────────────────
-- 0024_box_config_manifest.sql — WHAT EACH BOX SAYS ITS LIVE CONFIG IS
-- (PB-27, O-JWKS-FALLBACK-LIVES-TEN-MINUTES folds O-BOX-CONFIG-OUTSIDE-THE-LANE).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- Box B and Box C have their config applied over SSH and re-vendored by hand,
-- and nothing compared the live files with the vendored copies. Each box now
-- runs a cron (tooling/ops/boxes/post-config-manifest.sh) that hashes its live
-- compose, override and tunnel config and POSTs the hashes to
-- POST /v1/ops/box-manifest (src/routes/box-manifest.ts), authenticated with a
-- secret scoped to that ONE box. tooling/ops/check-box-config-drift.mjs reads
-- this table from ops-watch and compares it with the vendored hashes.
--
-- ONE ROW PER BOX, replaced whole on every post: a file that disappears from
-- the box disappears from the manifest, so "the box stopped sending X" is as
-- visible as "X changed". Hashes only — never a file's content.
--
--   box        'boxb' | 'boxc' (the route's closed set)
--   manifest   JSON: {"<logical name>": "<sha256 hex>", ...}
--   posted_at  the SERVER's time of the post, ISO-8601 TEXT (0017's header
--              records why never INTEGER); the reader's staleness limb reads it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS box_config_manifest (
  box       TEXT PRIMARY KEY,
  manifest  TEXT NOT NULL,
  posted_at TEXT NOT NULL
);
