-- docs/platform/supabase/sql/identity-address-null-on-write.sql
--
-- SYN-P2 (2026-10-02): the identity store keeps no network address. GoTrue
-- (Box C, supabase/gotrue:v2.189.0, auth.schema_migrations max 20260302000000)
-- has exactly THREE columns that can hold one, measured by a catalog read of
-- every inet/cidr column and every *ip / *ip_address column in both databases
-- of the stack (postgres and _supabase):
--
--   auth.sessions.ip                  inet, nullable          -> NULL
--   auth.audit_log_entries.ip_address varchar(64) NOT NULL '' -> ''
--   auth.mfa_challenges.ip_address    inet NOT NULL           -> 0.0.0.0
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
-- A BEFORE INSERT OR UPDATE trigger on each table empties that column on every
-- write, so GoTrue can keep writing it (its code does, on every sign-in and
-- refresh) and nothing reaches the row. NOT NULL columns get their empty value:
-- '' for the audit log (GoTrue's own default) and 0.0.0.0 for MFA challenges
-- (no MFA factor exists; GoTrue never reads the column back).
--
-- tooling/ci/assert-identity-address-columns.mjs holds this file to that list:
-- every column in tooling/legal/identity-address-columns.json must be emptied
-- here, by a trigger on its table, or the guard fails, and the app notice's "no
-- network address is stored" sentence may only render while it passes.
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
--    WHERE n.nspname = 'auth' AND t.tgname = 'nikatru_address_null_on_write'
--    ORDER BY 1;
--
--   Expect audit_log_entries, mfa_challenges, sessions, each tgenabled = O.
--
-- READ-BACK 2: sign a throwaway user in; then
--
--   SELECT count(*) FILTER (WHERE ip IS NOT NULL), count(*)
--     FROM auth.sessions WHERE created_at > '<the time you signed in>';
--
--   Expect 0 and at least 1.
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
--   DROP TRIGGER IF EXISTS nikatru_address_null_on_write ON auth.mfa_challenges;
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

CREATE OR REPLACE FUNCTION nikatru_privacy.mfa_ip_unspecified()
  RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.ip_address := '0.0.0.0'::inet;
  RETURN NEW;
END $$;

ALTER FUNCTION nikatru_privacy.sessions_ip_null() OWNER TO supabase_admin;
ALTER FUNCTION nikatru_privacy.audit_ip_empty() OWNER TO supabase_admin;
ALTER FUNCTION nikatru_privacy.mfa_ip_unspecified() OWNER TO supabase_admin;
REVOKE ALL ON FUNCTION nikatru_privacy.sessions_ip_null() FROM PUBLIC;
REVOKE ALL ON FUNCTION nikatru_privacy.audit_ip_empty() FROM PUBLIC;
REVOKE ALL ON FUNCTION nikatru_privacy.mfa_ip_unspecified() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nikatru_privacy.sessions_ip_null() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION nikatru_privacy.audit_ip_empty() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION nikatru_privacy.mfa_ip_unspecified() TO supabase_auth_admin;

DROP TRIGGER IF EXISTS nikatru_address_null_on_write ON auth.sessions;
CREATE TRIGGER nikatru_address_null_on_write
  BEFORE INSERT OR UPDATE ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION nikatru_privacy.sessions_ip_null();

DROP TRIGGER IF EXISTS nikatru_address_null_on_write ON auth.audit_log_entries;
CREATE TRIGGER nikatru_address_null_on_write
  BEFORE INSERT OR UPDATE ON auth.audit_log_entries
  FOR EACH ROW EXECUTE FUNCTION nikatru_privacy.audit_ip_empty();

DROP TRIGGER IF EXISTS nikatru_address_null_on_write ON auth.mfa_challenges;
CREATE TRIGGER nikatru_address_null_on_write
  BEFORE INSERT OR UPDATE ON auth.mfa_challenges
  FOR EACH ROW EXECUTE FUNCTION nikatru_privacy.mfa_ip_unspecified();

COMMIT;
