import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { REAUTH_REQUIRED_BODY, REAUTH_REQUIRED_STATUS, deletionRecencyRefusal } from '../../../_shared/src/auth';
import { eraseSubjectRows } from '../lib/erase-subject';

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /v1/account — SUBLY'S OWN ERASURE ROUTE, over subscriptiontracker_db (APP_DB).
//
// ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
// 🔴 THE ONLY APP IN THE FIELD WAS THE ONE APP NO ERASURE ROUTE REACHED. The
// shared server's DELETE /v1/account (services/platform/src/routes/account.ts)
// sweeps PLATFORM_DB and deletes the identity record — and touches nothing in
// subscriptiontracker_db, because a route reads the database it reads and not the ones its
// Worker happens to bind. So a Subly user could press "Delete account", watch it
// succeed, lose their login, and leave every subscription, budget, budget
// category and payment they had ever entered sitting in a database no login could
// ever reach again. tooling/legal/data-inventory.json carried FOUR rows declaring
// `erasure: no-route` for exactly this reason.
//
// That is a DPDP obligation and a hard store requirement — Google Play and the
// App Store both require a working in-app deletion path wherever an account can
// be created — and it is worse than an absent feature, because the user is told
// their data is gone and stops asking.
//
// ── WHY IT IS HERE AND NOT IN services/platform ─────────────────────────────
// The shared Worker already BINDS subscriptiontracker_db (`SUBSCRIPTIONTRACKER_DB`, for the nightly renewals
// fan-out), so it could have swept it directly in a dozen lines. That was
// considered and rejected:
//
//   · it would put one app's schema inside the portfolio's shared Worker, and
//     the schema is exactly what this route derives its behaviour from;
//   · the register (tooling/legal/data-inventory.json) names the hazard: an
//     irreversible route that erases every database its Worker binds makes any
//     FUTURE binding an erasure target the day it is added, silently;
//   · the brick's backend stamp already gives every app-api Worker its own
//     `DELETE /v1/account`. Subly predates the brick and is the one app without
//     one. Putting the route here makes Subly the same shape as app #2 rather
//     than a special case the shared Worker has to know about.
//
// ── WHAT THIS ROUTE DOES **NOT** DO, AND WHY THAT IS DELIBERATE ─────────────
// ⚠️ IT DOES NOT DELETE THE IDENTITY RECORD, AND IT DOES NOT TOUCH platform_db.
// The brick template's version does both; this one must not, because those rows
// are not Subly's. The identity is portfolio-wide and there must be exactly ONE
// piece of code that destroys it — two Workers racing to delete the same auth
// user is a partial-failure matrix nobody can reason about, and it would need
// this Worker to hold the Supabase SERVICE ROLE key, which is the most dangerous
// credential in the account and currently lives in one place. So the division is:
//
//   services/platform  — platform_db + the identity, and the ORDERING
//   services/subscriptiontracker-api — subscriptiontracker_db, and nothing else
//
// The shared route calls this one (relaying the caller's own bearer token) AFTER
// its service-role precondition and BEFORE it deletes the identity, so a failure
// here stops the erasure while the user still has a login to retry with. See the
// long note in services/platform/src/routes/account.ts.
//
// ⚠️ CONSEQUENCE, STATED RATHER THAN HIDDEN: `{ ok: true }` from THIS route means
// "subscriptiontracker_db no longer holds this user", NOT "the account is gone". The response
// says `scope: 'subscriptiontracker_db'` so no caller can read it as the latter.
//
// ── THE TABLE SET IS DERIVED FROM THE SCHEMA, NOT LISTED HERE ───────────────
// 🔴 The brick template carries `const appTables = ['records'];` with a comment
// warning that missing a table there means orphaned PII. That is a correctness
// property resting on somebody remembering to edit two files in one change, and
// the failure is SILENT and permanent: the route answers `{ ok: true }` and the
// rows stay. Here, as in the platform route, the database answers: every table
// carrying a `user_id` column is user-owned BY DEFINITION, so a migration that
// adds a user-owned table to subscriptiontracker_db is covered by that migration alone.
//
// The second rule is the same one, for the other spelling:
//   ·  user_id   → the row IS this person's        → DELETE the row
//   · *_user_id  → the row REFERENCES this person  → NULL the column
// subscriptiontracker_db has no `*_user_id` column today. The limb is still here, and it is not
// speculative: `payment_history.subscription_id` shows this schema already models
// cross-row references, and the day one of them names a user the rule covers it
// with no edit. Its emptiness is asserted (not assumed) by the test that plants a
// row in every table and sweeps for the id afterwards.
// ─────────────────────────────────────────────────────────────────────────────

const account = new Hono<AppEnv>();

// ⏱ 2026-09-12 · THE FOUR DECLARATIONS THAT USED TO SIT HERE NOW LIVE IN
// services/_shared/src/erasure.ts, imported above. They were byte-identical in both
// Workers and ABSENT FROM THE APP TEMPLATE, whose erasure route carried a hand-kept
// `const appTables = ['records'];` instead - so the derivation that makes this route
// correct reached both live Workers and never the factory. Their header holds the
// SQLITE_AUTH measurement behind the two-step walk, the identifier hygiene and the
// disjointness argument, unchanged.

// Mounted as `app.route('/v1', account)`, so the path declared HERE is the leaf.
// Declaring it `'/'` under `app.route('/v1/account', …)` yields `/v1/account/` —
// a DIFFERENT path from the one every caller builds. That exact mistake is
// recorded in the platform route; it is repeated here because the fix is the
// shape of this line and nothing enforces it.
account.delete('/account', async (c) => {
  const rid = c.get('requestId') ?? '-';

  // ── LIMB 0 · THE PROOF IS ASYMMETRIC, OR THERE IS NO ERASURE ──────────────
  // 🔴 THE REASON THIS ROUTE DID NOT EXIST UNTIL NOW. `supabaseAuth` — the
  // middleware every other route on this Worker uses — falls back to verifying
  // with the shared `SUPABASE_JWT_SECRET` when the JWKS path fails. A previous
  // review refused to port an erasure route onto that boundary, and was right
  // about the risk: a symmetric secret is a string, and whoever learns it can
  // mint a token for any user. Behind a read that is a data leak; behind THIS
  // route it is an unauthenticated remote wipe of anybody's account.
  //
  // The conclusion drawn from that risk was wrong, though — the answer is not to
  // leave every Subly user with no way to delete their data. It is to give the
  // route a STRICTER boundary than the Worker's default: `erasureAuth`
  // (src/middleware/auth.ts) verifies ES256 against the public JWKS and has no
  // secret in scope at all, and index.ts mounts this route behind it.
  //
  // This check is the SECOND limb, and it is not redundant with the mounting.
  // The mounting is one line in another file; a tidy-up that moved this route
  // under the permissive group would silently put account deletion behind the
  // shared secret and every existing test would still pass. Re-checking here
  // means that edit produces a loud, logged 403 instead.
  //
  // ⚠️ FAIL-CLOSED ON `undefined`. A route reached with NO auth middleware reads
  // undefined, which is not 'asymmetric', which is a refusal. The dangerous
  // spelling would have been `!== 'symmetric'`.
  const assurance = c.get('tokenAssurance');
  if (assurance !== 'asymmetric') {
    console.error(
      `[account] rid=${rid} app=${c.env.APP_ID} REFUSING ERASURE: this request was admitted with tokenAssurance=${assurance ?? 'none'}, and account deletion requires an ES256/JWKS-verified token. A shared HS256 secret is one leaked environment variable away from letting anyone erase any account, so it is not an acceptable proof for an irreversible route. Mount DELETE /v1/account behind erasureAuth.`,
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

  // ⏱ 2026-09-15 · [ADR 081]: THE WALK MOVED TO src/lib/erase-subject.ts, VERBATIM
  // IN BEHAVIOUR, so the platform's Service Binding retry (src/erasure-entrypoint.ts)
  // runs the SAME deletion code this route runs. What stayed here is what only this
  // door has: the asymmetric-token limb above, the request id and the HTTP shape.
  // The two refusals keep their status (503) and their reasons:
  //   · the schema read failed;
  //   · 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH — a derivation that stops
  //     finding tables would delete NOTHING and report `ok: true`, the shared route
  //     would take that as permission to delete the identity, and every row here
  //     would be orphaned behind a login that no longer exists.
  // And `scope` is still not decoration: this Worker erases ONE database, and a
  // caller that read a bare `{ ok: true }` as "the account is gone" would be wrong
  // in the one direction that matters.
  const result = await eraseSubjectRows(c.env.APP_DB, userId);
  if (!result.ok) {
    console.error(`[account] rid=${rid} app=${c.env.APP_ID} refusing deletion: ${result.reason}`);
    return c.json({ error: result.error }, 503);
  }
  return c.json(result);
});

export default account;
