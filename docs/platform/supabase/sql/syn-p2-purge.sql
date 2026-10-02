-- docs/platform/supabase/sql/syn-p2-purge.sql
--
-- SYN-P2: empty the network addresses stored BEFORE the null-on-write triggers
-- (identity-address-null-on-write.sql, applied on Box C 2026-10-01T20:00Z).
--
-- 🔴 NOT RUN, AND NOT TO BE RUN WITHOUT THE OWNER'S YES. Lead decision
-- 2026-10-01: no manual purge; existing values age out, and the notices say so
-- until they do. It is irreversible, which is why it is a file and not a step.
--
-- What it would empty, counted on 2026-10-02 (counts only, never values):
--   Box C:  auth.sessions 3 of 3 rows with an address; audit_log_entries 0 of
--           1518; mfa_challenges 0 rows.
--   Hosted (Cross_Platform_Auth, the cutover's rollback): auth.sessions 8 of 8,
--           newest refresh 2026-09-22; audit_log_entries 0.
-- It does NOT reach the identity dumps taken before 2026-10-02, on Box C
-- (pruned at 14 days) and off-box (Drive and Box B, never pruned).
--
-- ON BOX C, with the triggers in place, a no-op UPDATE is enough: the BEFORE
-- UPDATE trigger empties the column. Run as supabase_admin, the whole file:
--
--   docker compose exec -T db psql -U supabase_admin -d postgres -X \
--     -v ON_ERROR_STOP=1 -f - < syn-p2-purge.sql
--
-- ON THE HOSTED PROJECT, which has no triggers, use the explicit statements in
-- the second block instead (the SQL editor, as postgres).
--
-- READ-BACK (expect 0, 0):
--   SELECT (SELECT count(*) FROM auth.sessions WHERE ip IS NOT NULL),
--          (SELECT count(*) FROM auth.audit_log_entries WHERE ip_address <> '');

BEGIN;
UPDATE auth.sessions SET ip = ip WHERE ip IS NOT NULL;
UPDATE auth.audit_log_entries SET ip_address = ip_address WHERE ip_address <> '';
COMMIT;

-- Hosted project (no triggers):
--   BEGIN;
--   UPDATE auth.sessions SET ip = NULL WHERE ip IS NOT NULL;
--   UPDATE auth.audit_log_entries SET ip_address = '' WHERE ip_address <> '';
--   COMMIT;
