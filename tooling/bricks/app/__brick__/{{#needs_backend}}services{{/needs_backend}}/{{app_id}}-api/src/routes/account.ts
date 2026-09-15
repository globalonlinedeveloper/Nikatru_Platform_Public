import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { run } from '../lib/d1';
import { eraseSubjectRows } from '../lib/erase-subject';

// ─────────────────────────────────────────────────────────────────────────────
// G2 — in-app account deletion (server side). DELETE /v1/account purges every
// row this user owns from the app database, their shared-platform entitlements,
// AND their identity record, then returns what was deleted. The client
// (Settings → Delete account) calls this, then signs the user out of Supabase.
//
// ⏱ 2026-09-12 · NOTHING TO EXTEND PER APP ANY MORE, AND THAT IS THE POINT.
// This used to read "add every user-owned APP_DB table to `appTables`", with a
// warning that missing one meant orphaned personal data after "delete my account".
// That is a correctness property resting on somebody editing two files in one
// change, and it fails SILENTLY and permanently: the route answers ok, the rows
// stay, and the identity is gone by the time anyone could notice. The schema
// answers instead - every table carrying a `user_id` column is user-owned by
// definition - so a migration that adds a user-owned table is covered by that
// migration alone. Both live Workers had already been fixed this way; the
// template had not, which is the whole of the defect.
//
// 🔴 THREE LIMBS, AND THE THIRD IS THE ONE THAT WAS MISSING. This route used to
// purge `appTables` + entitlements and return `{ ok: true }` — with the identity
// record untouched. So after "your account has been deleted" the same email and
// password still logged in, to an account with no data. That is a deletion the
// user cannot detect as incomplete, which is exactly the failure the client half
// refuses to fake. Deleting the identity needs the SERVICE ROLE key, which no
// Worker held; it is now a required secret and the route REFUSES rather than
// reporting a success it cannot deliver.
// ─────────────────────────────────────────────────────────────────────────────
const account = new Hono<AppEnv>();

account.delete('/', async (c) => {
  // ── LIMB 0 · THE PROOF IS ASYMMETRIC, OR THERE IS NO ERASURE ──────────────
  // `supabaseAuth` — the middleware every other route uses — may verify with the
  // shared `SUPABASE_JWT_SECRET` when the JWKS path fails. A symmetric secret is
  // a string, and whoever learns it can mint a token for any user. Behind a read
  // that is a data leak; behind THIS route it is an unauthenticated remote wipe
  // of anybody's account. So `index.ts` mounts this route behind `erasureAuth`,
  // which has no secret in scope at all.
  //
  // 🔴 THIS CHECK IS THE SECOND LIMB AND IT IS NOT REDUNDANT WITH THE MOUNTING.
  // The mounting is one line in another file; a tidy-up that moved this route
  // under the permissive group would silently put account deletion behind the
  // shared secret and every existing test would still pass. Re-checking here
  // turns that edit into a loud, logged 403.
  //
  // ⚠️ FAIL-CLOSED ON `undefined`. A route reached with NO auth middleware reads
  // undefined, which is not 'asymmetric', which is a refusal. The dangerous
  // spelling would have been `!== 'symmetric'`.
  const assurance = c.get('tokenAssurance');
  if (assurance !== 'asymmetric') {
    console.error(
      `[account] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID} REFUSING ERASURE: admitted with tokenAssurance=${assurance ?? 'none'}, and account deletion requires an ES256/JWKS-verified token. A shared HS256 secret is one leaked environment variable away from letting anyone erase any account, so it is not an acceptable proof for an irreversible route. Mount DELETE /v1/account behind erasureAuth.`,
    );
    return c.json({ error: 'erasure_requires_asymmetric_auth' }, 403);
  }

  const userId = c.get('userId');

  // PRECONDITION, checked BEFORE anything is destroyed. Discovering halfway
  // through that the identity cannot be deleted would leave a user with no data
  // and a working login — strictly worse than refusing up front. Set it once per
  // Worker with:  wrangler secret put SUPABASE_SERVICE_ROLE_KEY
  const serviceRoleKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error(
      `[account] rid=${c.get('requestId') ?? '-'} refusing deletion: SUPABASE_SERVICE_ROLE_KEY is not set, so the identity record cannot be removed`,
    );
    return c.json({ error: 'account_deletion_unconfigured' }, 501);
  }

  // ⏱ 2026-09-15 · [ADR 081]: THE APP_DB WALK MOVED TO src/lib/erase-subject.ts,
  // unchanged in behaviour, so the platform's Service Binding retry
  // (src/erasure-entrypoint.ts) runs the SAME deletion code this route runs. Its
  // two refusals keep their 503: a failed schema read, and 🔴 AN EMPTY SET IS A
  // FAILURE, NOT A FAST PATH — a walk that found nothing would report ok and the
  // identity would then be deleted below, orphaning every row behind it.
  const walked = await eraseSubjectRows(c.env.APP_DB, userId);
  if (!walked.ok) {
    console.error(`[account] rid=${c.get('requestId') ?? '-'} refusing deletion: ${walked.reason}`);
    return c.json({ error: walked.error }, 503);
  }
  const deleted: Record<string, number> = { ...walked.deleted };
  const unlinked: Record<string, number> = { ...walked.unlinked };

  // Shared entitlements (PLATFORM_DB). Best-effort: the table may not exist in a
  // fresh platform database, so a failure here must not block the deletion.
  try {
    const res = await run(
      c.env.PLATFORM_DB.prepare('DELETE FROM entitlements WHERE user_id = ?').bind(userId),
    );
    deleted['entitlements'] = res.meta.changes ?? 0;
  } catch {
    deleted['entitlements'] = 0;
  }

  // The IDENTITY record, last — the row that decides whether the login still
  // works. 404 counts as done: the user is gone, which is what was asked for,
  // and a retry after a partial failure must not fail on the second pass.
  // The key is never echoed, logged, or returned.
  const identityRes = await fetch(
    `${c.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  if (!identityRes.ok && identityRes.status !== 404) {
    console.error(
      `[account] rid=${c.get('requestId') ?? '-'} identity delete failed with ${identityRes.status}`,
    );
    // NOT ok:true. The data is gone and the login is not — the user must be
    // told, and the client turns this into a visible failure rather than a
    // "deleted" they cannot verify. The purges above are idempotent, so a retry
    // is safe.
    return c.json({ error: 'identity_delete_failed' }, 502);
  }
  deleted['identity'] = 1;

  // `unlinked` is reported beside `deleted` because they are different claims:
  // rows removed, versus rows that merely stopped naming this person. A caller
  // that read one as the other would be told more than happened.
  return c.json({ ok: true, deleted, unlinked });
});

export default account;
