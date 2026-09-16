-- ─────────────────────────────────────────────────────────────────────────────
-- 0012_apple_provider_tokens.sql — THE ONE THING A SIGN IN WITH APPLE DELETION
-- CANNOT BE DONE WITHOUT.
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- O-SIWA-NO-CLICKWRAP's sibling row O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE. Apple
-- requires an app that offers Sign in with Apple to REVOKE the user's tokens when
-- their account is deleted, through `POST https://appleid.apple.com/auth/revoke`
-- — and that call takes a token. Supabase hands the provider's refresh token to
-- the CLIENT once, in the session that completes the OAuth redirect, and stores
-- none of it: "Supabase does not store them for security reasons… it is up to you
-- to store somewhere" (supabase/auth discussions #22578, #22653, read 2026-09-16).
-- supabase/auth#1308, "Revoke Sign in with Apple tokens", is CLOSED AS NOT
-- PLANNED. So either we keep the token or the revocation cannot happen at all.
--
-- 🔴 THIS TABLE HOLDS A LIVE CREDENTIAL, WHICH `pending_erasures` DELIBERATELY DOES
-- NOT. One row per subject, holding Apple's refresh token for THIS relying party.
-- What it can do is bounded: with our client secret it exchanges for an Apple
-- access token scoped to the same identity, and it is the input to the revoke call
-- it exists for. It is not a Supabase session, it cannot sign in to this product,
-- and it is useless without the private key the owner holds. It is still a
-- credential: nothing logs it, no route reads it back, and the only reader is
-- services/platform/src/lib/apple-revoke.ts.
--
-- 🔴 NO `user_id` COLUMN, FOR THE REASON 0010 RECORDS AND ONE MORE. The erasure
-- walk (services/_shared/src/erasure.ts) deletes every row in every table with a
-- `user_id` column — which would destroy the token MID-DELETION, before the
-- revoke that the deletion exists to perform. The subject is `subject_ref`, and
-- the row is deleted explicitly by the revoke path once Apple has answered.
--
-- `app_id` IS THE PROVENANCE MARKER, and it is why this table has a fourth
-- column at all: tooling/prod-provenance.json must be able to say how a row got
-- here, the token may never be read for that and a timestamp attributes nothing.
-- It is the app whose sign-in produced the token, sent by the client and resolved
-- against the shipped catalogue (`app-catalogue`), exactly as `pending_erasures`
-- does — so a row naming anything but an app this factory ships is visible as
-- unattributed instead of counting silently.
--
-- RETENTION: the row lives while the account does. It is deleted when the token is
-- revoked (the erasure), and — because a revoke that cannot be completed must not
-- leave a credential behind forever — when the erasure is abandoned, by the same
-- nightly `erasureRetry` that clears the ledger. There is no age-based sweep: a
-- row deleted by age would silently make the account's deletion unrevokable.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS apple_provider_tokens (
  subject_ref   TEXT PRIMARY KEY NOT NULL,
  app_id        TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  stored_at     TEXT NOT NULL
);
