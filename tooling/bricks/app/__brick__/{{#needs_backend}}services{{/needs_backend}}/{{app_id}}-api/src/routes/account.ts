import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { REAUTH_REQUIRED_BODY, REAUTH_REQUIRED_STATUS, deletionRecencyRefusal } from '../../../_shared/src/auth';
import { eraseSubjectRows } from '../lib/erase-subject';

// ─────────────────────────────────────────────────────────────────────────────
// G2 — in-app account deletion, THIS APP'S HALF. DELETE /v1/account purges every
// row this user owns from the app database (APP_DB) and returns what was
// deleted. That is all it does.
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
// ── ⏱ 2026-09-24 · O-BRICK-ERASURE-DESTROYS-THE-IDENTITY · THE FLAGSHIP SHAPE ──
// ⚠️ IT DOES NOT DELETE THE IDENTITY RECORD, AND IT DOES NOT TOUCH PLATFORM_DB.
// Until today this template's route did both: it purged APP_DB, deleted the
// caller's rows from the SHARED entitlements table, and then deleted the Supabase
// identity itself with the service-role key. The live app Worker
// (services/subscriptiontracker-api/src/routes/account.ts) had been built the
// other way, and the template had not followed it. So every stamped backend was
// born as a SECOND identity deleter — one that skipped what the platform's
// deleter does before it (the signup-list purge, the Apple token revoke, the
// fan-out to every other app) and needed the most dangerous credential in the
// account to do it.
//
// The identity is portfolio-wide, and it is destroyed by ONE piece of code:
// services/platform/src/lib/platform-erasure.ts, behind the shared Worker's
// DELETE /v1/account. The division is the live app's:
//
//   services/platform   — platform_db + the identity, and the ORDERING
//   this Worker         — this app's APP_DB, and nothing else
//
// The client enters at the shared Worker (the stamped app's
// `platformRestClientProvider`). The shared route relays to this route with the
// caller's own bearer token — once this app is named in its
// APP_ERASURE_ENDPOINTS, which is a provisioning act — AFTER its own
// precondition and BEFORE it deletes the identity, so a failure here stops the
// erasure while the user still has a login to retry with.
//
// 🔴 `assert-erasure-reach.mjs` limb 6 counts the Worker source files that call
// the identity-delete endpoint, over every Worker and this template: exactly one,
// inside the shared Worker. Putting the call back here is red on that guard,
// and on the `account-deletion-works` absent anchors in
// `assert-stamp-properties.mjs`.
//
// ⚠️ CONSEQUENCE, STATED RATHER THAN HIDDEN: `{ ok: true }` from THIS route means
// "APP_DB no longer holds this user", NOT "the account is gone".
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

  // ── LIMB 0b · ⏱ 2026-09-16 · O-APP-API-DELETE-NO-RECENCY — A RECENT SIGN-IN ──
  // 🔴 A VALID TOKEN IS NOT A RECENT SIGN-IN. The limb above proves the token is
  // real; it says nothing about WHEN its holder last authenticated, so anyone
  // holding a live session token could call this Worker directly and erase the
  // account's rows. The rule is the platform Worker's, read from ONE place —
  // services/_shared/src/auth.ts `deletionRecencyRefusal` — so the two ends of one
  // erasure cannot disagree: a password-less account must have authenticated
  // (`amr`, never `iat`) within RECENT_AUTH_SECONDS; a password account is not
  // held to it at either end (the decision and its reason are recorded there).
  // Checked BEFORE any precondition and before any row is touched, and refused
  // with 403 `reauth_required` — never 401, which the client reads as a dead
  // session and signs the person out.
  const stale = deletionRecencyRefusal(c.get('authRecency'));
  if (stale !== null) {
    console.warn(`[account] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID} refusing erasure: ${stale}`);
    return c.json(REAUTH_REQUIRED_BODY, REAUTH_REQUIRED_STATUS);
  }

  const userId = c.get('userId');

  // ⏱ 2026-09-15 · [ADR 081]: THE APP_DB WALK MOVED TO src/lib/erase-subject.ts,
  // unchanged in behaviour, so the platform's Service Binding retry
  // (src/erasure-entrypoint.ts) runs the SAME deletion code this route runs. Its
  // two refusals keep their 503: a failed schema read, and 🔴 AN EMPTY SET IS A
  // FAILURE, NOT A FAST PATH — a walk that found nothing would report ok, the
  // shared route would take that as permission to delete the identity, and every
  // row here would be orphaned behind a login that no longer exists.
  const walked = await eraseSubjectRows(c.env.APP_DB, userId);
  if (!walked.ok) {
    console.error(`[account] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID} refusing deletion: ${walked.reason}`);
    return c.json({ error: walked.error }, 503);
  }
  // `unlinked` is reported beside `deleted` because they are different claims:
  // rows removed, versus rows that merely stopped naming this person. A caller
  // that read one as the other would be told more than happened.
  return c.json(walked);
});

export default account;
