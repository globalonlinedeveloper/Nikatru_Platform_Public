-- ─────────────────────────────────────────────────────────────────────────────
-- 0021_ext_link_floor.sql — A PASSWORD RESET, OR "SIGN OUT EVERYWHERE", ENDS
-- EVERY BROWSER LINK MINTED BY A SESSION THAT SIGNED IN BEFORE IT
-- (EXA-11, round-2 review finding 1, lead ruling 2026-09-30).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- 🔴 WHY A FLOOR AND NOT A ONE-TIME UPDATE. The first cut revoked the links
-- whose `created_at` was before the reset — once. A session that had signed in
-- BEFORE the reset still holds a valid access token for up to an hour (GoTrue
-- never revokes an issued access token), and with it it could mint a fresh link
-- AFTER the reset, whose `created_at` is new. So the rule is a standing one, the
-- same shape `withRevokedBefore` is for JWTs:
--
--   auth_at        on ext_codes and ext_devices: when the session that minted
--                  the code last AUTHENTICATED (platformAuth's `authRecency` —
--                  the newest `amr` timestamp, which a refresh does not move;
--                  the token's `iat` only when it carries no `amr`). Copied from
--                  the code into the link at exchange.
--   ext_link_floor one row per account: `not_before`. POST /v1/sessions/revoke-all
--                  and a recovery session raise it to the server's now.
--
-- A link — or a code, at exchange — whose `auth_at` is before the account's
-- `not_before` is dead, WHENEVER it was minted. A NULL `auth_at` (a link minted
-- before this migration) counts as older than any floor; with no floor row it
-- is judged by its lifetime alone, exactly as before.
--
-- 🔴 ISO-8601 TEXT, NEVER INTEGER (0017's header records why).
-- 🔴 `user_id`, SPELT EXACTLY: the erasure walk deletes the floor with the account.
-- `recovery_session` names the GoTrue session whose recovery last raised the
-- floor, so the recovery door writes ONCE per session, not once per request.
--
-- REPLAY: `ALTER TABLE … ADD COLUMN` has no IF NOT EXISTS form, so this file is
-- ledger-protected and NOT in REPLAY_SAFE_MIGRATIONS (test/harness.ts), as 0004
-- and 0018 are.
--
-- RETENTION: a floor row is a fact about the account and lives until erasure;
-- it is one row per account that ever signed out everywhere or reset.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ext_codes ADD COLUMN auth_at TEXT;
ALTER TABLE ext_devices ADD COLUMN auth_at TEXT;

CREATE TABLE IF NOT EXISTS ext_link_floor (
  user_id          TEXT PRIMARY KEY NOT NULL,
  not_before       TEXT NOT NULL,
  recovery_session TEXT,
  updated_at       TEXT NOT NULL
);
