-- docs/platform/supabase/sql/sessions-rpc.sql
--
-- AUTH-REVOKE-AT-WORKERS (2026-09-25): the two service-role RPCs behind
-- services/platform/src/routes/sessions.ts: list one account's sign-in
-- sessions, and end ONE of them.
--
-- ⚠️ NOT A MIGRATION. services/*/migrations/ holds D1 (SQLite) migrations that
-- deploy-workers applies; this file targets the HOSTED Supabase Postgres, which
-- no workflow and no Worker can write to. It lives under docs/ on purpose, and
-- tooling/ci/check-migrations.mjs does not glob it.
--
-- APPLIED BY THE PARENT, AFTER REVIEW, BY HAND: the Supabase SQL editor (runs as
-- `postgres`), the whole file at once. It is one transaction, so a function is
-- never visible with the default PUBLIC execute grant. Until it is applied the
-- three routes that call a function (GET /v1/sessions, DELETE /v1/sessions/:id,
-- POST /v1/sessions/revoke-others) answer 503 (PostgREST 404 PGRST202 → "not
-- installed"); POST /v1/sessions/revoke-all calls neither and works regardless.
-- Re-applying is safe: CREATE OR REPLACE, then the grants again.
--
-- Why SECURITY DEFINER with an explicit p_user: the Worker calls with the
-- service-role key, so auth.uid() is NULL here. The Worker passes the `sub` of a
-- token it has already verified; `user_id = p_user` in BOTH functions is what
-- stops one account listing or ending another account's session. Only
-- service_role may execute: Supabase's default privileges grant EXECUTE on new
-- public functions to anon and authenticated, and PostgREST would otherwise
-- expose both at /rest/v1/rpc/ to anyone holding the anon key.
--
-- `ip` is deliberately NOT returned: the sessions list shows a device label, and
-- an IP address the Worker never needs is personal data it never holds.
--
-- READ-BACK 1: both functions exist, are SECURITY DEFINER, pin search_path,
-- and their owner can read and delete auth.sessions:
--
--   SELECT p.proname, p.prosecdef, p.proconfig,
--          pg_catalog.pg_get_userbyid(p.proowner) AS owner,
--          pg_catalog.has_table_privilege(p.proowner, 'auth.sessions', 'SELECT') AS owner_select,
--          pg_catalog.has_table_privilege(p.proowner, 'auth.sessions', 'DELETE') AS owner_delete
--     FROM pg_catalog.pg_proc AS p
--     JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('nikatru_sessions_of', 'nikatru_revoke_session');
--
--   Expect exactly two rows, prosecdef = t, proconfig = {"search_path=\"\""},
--   owner_select = t and owner_delete = t. Any other answer: roll back.
--
-- READ-BACK 2: only service_role can execute either one:
--
--   SELECT r.rolname,
--          pg_catalog.has_function_privilege(r.rolname, 'public.nikatru_sessions_of(uuid)', 'EXECUTE') AS sessions_of,
--          pg_catalog.has_function_privilege(r.rolname, 'public.nikatru_revoke_session(uuid, uuid)', 'EXECUTE') AS revoke_session
--     FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname);
--
--   Expect anon f f, authenticated f f, service_role t t. Any other answer: roll back.
--
-- ROLLBACK (the Worker then answers 503 on the three routes that call a
-- function; revoke-all keeps working, and nothing else reads these functions):
--
--   DROP FUNCTION IF EXISTS public.nikatru_revoke_session(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.nikatru_sessions_of(uuid);

BEGIN;

CREATE OR REPLACE FUNCTION public.nikatru_sessions_of(p_user uuid)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  refreshed_at timestamp,
  user_agent text,
  aal text,
  not_after timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.created_at, s.refreshed_at, s.user_agent, s.aal::text, s.not_after
    FROM auth.sessions AS s
   WHERE s.user_id = p_user
   ORDER BY s.created_at DESC;
$$;

-- Deleting the auth.sessions row cascades to auth.refresh_tokens, so the
-- session's refresh token dies here. Its already-issued access token is refused
-- by the Workers' revocation list, which the route writes after this returns.
CREATE OR REPLACE FUNCTION public.nikatru_revoke_session(p_user uuid, p_session uuid)
RETURNS TABLE (id uuid)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM auth.sessions AS s
   WHERE s.id = p_session
     AND s.user_id = p_user
  RETURNING s.id;
$$;

REVOKE ALL ON FUNCTION public.nikatru_sessions_of(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nikatru_revoke_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nikatru_sessions_of(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nikatru_revoke_session(uuid, uuid) TO service_role;

COMMIT;

-- PostgREST caches the schema; the hosted project reloads it on DDL, and this
-- makes that explicit.
NOTIFY pgrst, 'reload schema';
