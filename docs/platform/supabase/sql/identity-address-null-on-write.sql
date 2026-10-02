-- docs/platform/supabase/sql/identity-address-null-on-write.sql
--
-- SYN-P2 (2026-10-02): the identity store keeps no network address beyond a
-- pending MFA sign-in verification (below). GoTrue
-- (Box C, supabase/gotrue:v2.189.0, auth.schema_migrations max 20260302000000)
-- has exactly THREE columns that can hold one, measured by a catalog read of
-- every inet/cidr column and every *ip / *ip_address column in both databases
-- of the stack (postgres and _supabase):
--
--   auth.sessions.ip                  inet, nullable          -> NULL
--   auth.audit_log_entries.ip_address varchar(64) NOT NULL '' -> ''
--   auth.mfa_challenges.ip_address    inet NOT NULL           -> 0.0.0.0 once VERIFIED,
--                                                                or once EXPIRED (below)
--
-- THE CATALOG READ (names only; run it in postgres AND in _supabase after every
-- GoTrue upgrade, and add any new column here and to
-- tooling/legal/identity-address-columns.json):
--
--   SELECT table_schema, table_name, column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
--      AND (data_type IN ('inet', 'cidr')
--           OR column_name ~* '(^|_)(ip|ip_address|remote_addr|client_ip|ip_addr)$')
--    ORDER BY 1, 2, 3;
--
-- A BEFORE INSERT OR UPDATE trigger on each of the first two tables empties
-- that column on every write, so GoTrue can keep writing it (its code does, on
-- every sign-in and refresh) and nothing reaches the row. The NOT NULL audit
-- column gets '' (GoTrue's own default).
--
-- 🔴 auth.mfa_challenges IS NOT EMPTIED ON EVERY WRITE (review 1 of #1140,
-- finding 3), and MFA STAYS ON (ruling on review 2, item 1: TOTP enrolment is
-- a security control, and this file never turns it off). GoTrue READS that
-- column back while the challenge is PENDING. v2.189.0
-- internal/api/mfa.go, validateChallenge (TOTP and WebAuthn) and
-- verifyPhoneFactor, compare it BEFORE anything writes verified_at:
--
--   574  currentIP := utilities.GetIPAddress(r)
--   584  if challenge.VerifiedAt != nil || challenge.IPAddress != currentIP {
--   585      return nil, apierrors.NewUnprocessableEntityError(apierrors.ErrorCodeMFAIPAddressMismatch, ...
--   588  if challenge.HasExpired(config.MFA.ChallengeExpiryDuration) {
--   ...  (verifyTOTPFactor: validateChallenge at 634, the TOTP check, then
--   702      if terr = challenge.Verify(tx); terr != nil {   -- in the success transaction)
--   774  if challenge.VerifiedAt != nil || challenge.IPAddress != currentIP {   -- verifyPhoneFactor
--   854      if terr = challenge.Verify(tx); terr != nil {
--
-- and internal/models/challenge.go:84-87, Verify = `tx.UpdateOnly(c, "verified_at")`,
-- an UPDATE. So once verified_at is set the address is never read again (a
-- verified challenge is refused at 584/774 whatever it holds), and a challenge
-- older than ChallengeExpiryDuration (internal/conf/configuration.go: default
-- 300 s, and any lower setting is raised to 300) is refused at 588/778. Hence:
--
--   1. a BEFORE UPDATE trigger sets ip_address to 0.0.0.0 (the column is inet
--      NOT NULL; 0.0.0.0 is the unspecified address, nobody's) on the write
--      that sets verified_at. INSERT is NOT touched: the pending challenge
--      must keep the address verify compares, or every MFA verify fails;
--   2. nikatru_privacy.mfa_challenge_ip_sweep() sets it to 0.0.0.0 on every
--      challenge created more than 300 s ago, so an abandoned challenge does
--      not keep it; docs/platform/supabase/boxc/identity-log-retention.sh runs
--      it daily (watched: duty.supabase-identity-log-retention).
--
-- So a PENDING sign-in verification holds the address for at most 300 s plus
-- a day, and the notices say exactly that. ⚠️ The sweep's 300 s is GoTrue's
-- DEFAULT expiry: a compose setting GOTRUE_MFA_CHALLENGE_EXPIRY_DURATION above
-- 300 would let the sweep blank a challenge still pending (its verify then
-- fails as a mismatch, never a pass); raise the sweep's interval with it.
-- (WebAuthn destroys its challenge on use, mfa.go:956, so its row is gone.)
-- This file also DROPS the every-write trigger an earlier version put there.
--
-- tooling/ci/assert-app-yaml.mjs limb 10 holds this file to that list: every
-- column in tooling/legal/identity-address-columns.json `columns` must be
-- emptied here, by a trigger on its table; every column in its `exempt` list
-- (the MFA challenge address) must be touched ONLY by its declared on-verify
-- trigger and its declared sweep, compared by table and function, never by a
-- trigger's name, or the guard fails.
--
-- ⚠️ NOT A MIGRATION THAT ANY WORKFLOW RUNS (see sessions-rpc.sql): applied on
-- Box C by hand, the whole file at once, as supabase_admin:
--
--   docker compose exec -T db psql -U supabase_admin -d postgres -X \
--     -v ON_ERROR_STOP=1 -f - < identity-address-null-on-write.sql
--
-- WHY THESE OWNERS: GoTrue runs its migrations as supabase_auth_admin and owns
-- the auth schema. The function lives in its OWN schema, nikatru_privacy, owned
-- by supabase_admin, so no GoTrue migration can replace or drop it; only a
-- migration that drops and recreates one of the three tables could drop its
-- trigger, and READ-BACK 1 below is how that is found. Re-applying is safe.
--
-- READ-BACK 1 (names and counts only): three enabled triggers, one per table:
--
--   SELECT c.relname, t.tgname, t.tgenabled::text
--     FROM pg_catalog.pg_trigger t
--     JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
--     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'auth' AND t.tgname LIKE 'nikatru_%'
--    ORDER BY 1;
--
--   Expect audit_log_entries and sessions (nikatru_address_null_on_write) and
--   mfa_challenges (nikatru_mfa_ip_blank_on_verify), each tgenabled = O.
--
-- READ-BACK 2: sign a throwaway user in; then
--
--   SELECT count(*) FILTER (WHERE ip IS NOT NULL), count(*)
--     FROM auth.sessions WHERE created_at > '<the time you signed in>';
--
--   Expect 0 and at least 1.
--
-- READ-BACK 3 (the MFA challenge address: pending only, counts only):
--
--   SELECT nikatru_privacy.mfa_challenge_ip_sweep();   -- rows it blanked
--   SELECT count(*) FROM auth.mfa_challenges
--    WHERE ip_address <> '0.0.0.0'::inet
--      AND (verified_at IS NOT NULL OR created_at < now() - interval '300 seconds');
--   -- expect 0
--
-- THE VALUES STORED BEFORE THIS FILE WAS APPLIED are not touched by it: the
-- one-time purge is docs/platform/supabase/sql/syn-p2-purge.sql, written and
-- NOT run (lead decision 2026-10-01: no manual purge; the values age out, and
-- the notices say so until they do).
--
-- ROLLBACK:
--
--   DROP TRIGGER IF EXISTS nikatru_address_null_on_write ON auth.sessions;
--   DROP TRIGGER IF EXISTS nikatru_address_null_on_write ON auth.audit_log_entries;
--   DROP TRIGGER IF EXISTS nikatru_mfa_ip_blank_on_verify ON auth.mfa_challenges;
--   DROP SCHEMA IF EXISTS nikatru_privacy CASCADE;

BEGIN;

CREATE SCHEMA IF NOT EXISTS nikatru_privacy AUTHORIZATION supabase_admin;
REVOKE ALL ON SCHEMA nikatru_privacy FROM PUBLIC;
GRANT USAGE ON SCHEMA nikatru_privacy TO supabase_auth_admin;

-- One function per column shape. Each sets the column on NEW and returns it;
-- they read nothing and write nothing else.
CREATE OR REPLACE FUNCTION nikatru_privacy.sessions_ip_null()
  RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.ip := NULL;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION nikatru_privacy.audit_ip_empty()
  RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.ip_address := '';
  RETURN NEW;
END $$;

-- The MFA challenge address (header): kept while the challenge is pending,
-- because verify compares it; emptied by the write that sets verified_at.
CREATE OR REPLACE FUNCTION nikatru_privacy.mfa_ip_blank_on_verify()
  RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.verified_at IS NOT NULL THEN
    NEW.ip_address := '0.0.0.0';
  END IF;
  RETURN NEW;
END $$;

-- And on every challenge past GoTrue's 300 s expiry. Returns the rows it blanked.
CREATE OR REPLACE FUNCTION nikatru_privacy.mfa_challenge_ip_sweep()
  RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  UPDATE auth.mfa_challenges SET ip_address = '0.0.0.0'
   WHERE created_at < now() - interval '300 seconds' AND ip_address <> '0.0.0.0'::inet;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

ALTER FUNCTION nikatru_privacy.sessions_ip_null() OWNER TO supabase_admin;
ALTER FUNCTION nikatru_privacy.audit_ip_empty() OWNER TO supabase_admin;
REVOKE ALL ON FUNCTION nikatru_privacy.sessions_ip_null() FROM PUBLIC;
REVOKE ALL ON FUNCTION nikatru_privacy.audit_ip_empty() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nikatru_privacy.sessions_ip_null() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION nikatru_privacy.audit_ip_empty() TO supabase_auth_admin;
ALTER FUNCTION nikatru_privacy.mfa_ip_blank_on_verify() OWNER TO supabase_admin;
ALTER FUNCTION nikatru_privacy.mfa_challenge_ip_sweep() OWNER TO supabase_admin;
REVOKE ALL ON FUNCTION nikatru_privacy.mfa_ip_blank_on_verify() FROM PUBLIC;
REVOKE ALL ON FUNCTION nikatru_privacy.mfa_challenge_ip_sweep() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nikatru_privacy.mfa_ip_blank_on_verify() TO supabase_auth_admin;

DROP TRIGGER IF EXISTS nikatru_address_null_on_write ON auth.sessions;
CREATE TRIGGER nikatru_address_null_on_write
  BEFORE INSERT OR UPDATE ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION nikatru_privacy.sessions_ip_null();

DROP TRIGGER IF EXISTS nikatru_address_null_on_write ON auth.audit_log_entries;
CREATE TRIGGER nikatru_address_null_on_write
  BEFORE INSERT OR UPDATE ON auth.audit_log_entries
  FOR EACH ROW EXECUTE FUNCTION nikatru_privacy.audit_ip_empty();

-- The MFA challenge address (header): the every-write trigger an earlier
-- version of this file created there is removed, with its function, and the
-- on-verify one takes its place.
DROP TRIGGER IF EXISTS nikatru_address_null_on_write ON auth.mfa_challenges;
DROP FUNCTION IF EXISTS nikatru_privacy.mfa_ip_unspecified();
DROP TRIGGER IF EXISTS nikatru_mfa_ip_blank_on_verify ON auth.mfa_challenges;
CREATE TRIGGER nikatru_mfa_ip_blank_on_verify
  BEFORE UPDATE ON auth.mfa_challenges
  FOR EACH ROW EXECUTE FUNCTION nikatru_privacy.mfa_ip_blank_on_verify();

COMMIT;
