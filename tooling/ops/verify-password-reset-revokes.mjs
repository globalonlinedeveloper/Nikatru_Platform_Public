#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-password-reset-revokes.mjs — does a PASSWORD RESET actually end the
// other sessions? Measured against the live auth backend, on a throwaway user.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// Owner ruling 2026-09-15 (OWNER_QUEUE S-9, register O-AUTH-PASSWORD-RESET-
// HARDENING) decided that "a reset ends the other sessions", and its closing
// condition asks in so many words for "a test proving a reset revokes other
// refresh tokens". This is that test. It is not a unit test, and it could not
// be one: the behaviour belongs to GoTrue, not to any code in this repository,
// so the only input that can distinguish "it revokes" from "we believe it
// revokes" is a real session against the real server.
//
// ── WHAT IS ACTUALLY BEING ASSERTED, STATED PRECISELY ────────────────────────
// The REFRESH-TOKEN layer, not the access-token layer, and the difference is
// the whole reason the 2026-08-11 reading said "a password reset does not end
// other sessions" while the source says it always has:
//   · `models.User.UpdatePassword` calls `LogoutAllExceptMe` (self-service) or
//     `Logout` (admin), deleting the other sessions' refresh-token rows AT ONCE.
//     There is no config flag for this; it is unconditional.
//   · An access token ALREADY ISSUED is a stateless JWT, verified by signature
//     and never looked up, so a device holding one keeps working until it tries
//     to REFRESH — up to `jwt_exp` (3600 s live). That window is what the
//     2026-08-11 probe most likely watched.
// So: this asserts the refresh is REJECTED. It deliberately does not assert
// anything about an unexpired access token, because nothing in the ruling asks
// for that and closing that window is separate, larger work in
// services/_shared/src/auth.ts.
//
// ── THE NEGATIVE CONTROL, AND WHY THE RUN IS VOID WITHOUT IT ─────────────────
// "The second session's refresh was rejected" proves nothing on its own: a
// typo'd token, a wrong endpoint, a project that refuses every refresh, or a
// session that was never established would all produce the same rejection, and
// the run would report a pass over a probe that never worked. So the SAME
// refresh token is exercised TWICE:
//     CONTROL  refresh BEFORE the reset  → must SUCCEED
//     SUBJECT  refresh AFTER  the reset  → must be REJECTED
// A failed control is exit 2 (UNKNOWN), never exit 0. This is the same shape as
// the GlitchTip IP probe's control leg and the on-box privacy test's: a void
// result must never be readable as a pass.
//
// ── WHY A RECOVERY LINK AND NOT A SELF-SERVICE PASSWORD CHANGE ───────────────
// The ruling is about a RESET, and since 2026-09-16 the live project also has
// `security_update_password_require_reauthentication` on, which makes a
// self-service `PUT /user {password}` demand a fresh nonce that arrives BY
// EMAIL — unautomatable, and not what "reset" means anyway. `admin/generate_link
// type=recovery` mints exactly the token the emailed link carries, and `/verify`
// turns it into the recovery session a user would land in. That is the real
// flow, driven without a mailbox. (`/verify` is also the one route that is not
// captcha-gated, which tooling/e2e/provision_user.mjs already depends on.)
//
// ⚠️ IT CREATES A REAL USER ON THE LIVE PROJECT AND DELETES IT AGAIN, in a
// `finally`, whatever happens. That is why it is a LAPTOP AND RUNBOOK STEP and
// is wired into no workflow: a probe that provisions an account is not
// something to run on a schedule. tooling/e2e/ does the same thing nightly, on
// purpose, under a workflow that owns the cleanup.
//
// Credentials, from the environment or from .claude/secrets.env when run from
// the repo root — never printed, ever:
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and the service-role key
//   (SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_Secret_key as the vault spells it).
//
// Usage:  node tooling/ops/verify-password-reset-revokes.mjs [repoRoot]
// Exit 0 = the reset revoked the other session's refresh token.
//      1 = IT DID NOT — a pre-existing session still refreshes after a reset.
//      2 = UNKNOWN: no credential, or a leg could not be measured (which
//          includes a failed control). NOT a pass.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const NAME = 'verify-password-reset-revokes';
const repoRoot = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd());

/** Exact `^NAME=` line match. NEVER a split on `=`: a free-form paste in the
 *  vault has no `=`, and a splitting reader prints the live value whole. */
function fromVault(name) {
  const p = join(repoRoot, '.claude', 'secrets.env');
  if (!existsSync(p)) return undefined;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*)$/);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}
const cred = (...names) => {
  for (const n of names) {
    const v = process.env[n] || fromVault(n);
    if (v) return v;
  }
  return undefined;
};

const unknown = (why, detail) => {
  console.error(`${NAME}: ✗ COVERAGE LOST — ${why}`);
  if (detail) console.error(`  ${detail}`);
  console.error('  Nothing was proved, so this is UNKNOWN: a real gap, not a pass, and not a finding.');
  process.exitCode = 2;
  throw new Halt();
};
class Halt extends Error {}

const url = (cred('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const anon = cred('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');
const service = cred('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_Secret_key');

const main = async () => {
  if (!url || !anon || !service) {
    unknown(
      'no credential.',
      'Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and the service-role key, from the environment or the vault.',
    );
  }

  const adminHeaders = { 'Content-Type': 'application/json', apikey: service, Authorization: `Bearer ${service}` };
  const anonHeaders = { 'Content-Type': 'application/json', apikey: anon };

  const json = async (res) => {
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
  };

  // GoTrue rejects @example.com; the e2e harness uses a labelled @nikatru.com
  // address for the same reason, and the label is what makes a leftover row
  // identifiable if a run is ever killed between the create and the delete.
  const email = `auth-reset-probe+${Date.now()}@nikatru.com`;
  const password = `Pr0be${randomBytes(24).toString('hex')}`;
  const newPassword = `R3set${randomBytes(24).toString('hex')}`;
  let userId = null;

  try {
    // ── 1. a throwaway, pre-confirmed user ──────────────────────────────────
    const created = await json(await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ email, password, email_confirm: true }),
    }));
    if (created.status < 200 || created.status >= 300) {
      unknown(`could not create the probe user (HTTP ${created.status}).`, JSON.stringify(created.body).slice(0, 300));
    }
    userId = created.body?.id ?? created.body?.user?.id ?? null;
    if (!userId) unknown('the create returned no user id, so there is nothing to clean up or to test.');
    console.log(`${NAME}: probe user created (${email})`);

    // ── 2. two sessions, i.e. two independent refresh tokens ────────────────
    const signIn = async (label) => {
      const r = await json(await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: anonHeaders, body: JSON.stringify({ email, password }),
      }));
      if (r.status !== 200 || !r.body?.refresh_token) {
        unknown(`session ${label} could not sign in (HTTP ${r.status}).`, JSON.stringify(r.body).slice(0, 300));
      }
      return r.body;
    };
    const sessionA = await signIn('A');
    const sessionB = await signIn('B');
    if (sessionA.refresh_token === sessionB.refresh_token) {
      unknown('both sign-ins returned the SAME refresh token, so there is only one session and "the OTHER session" does not exist in this run.');
    }
    console.log(`${NAME}: two distinct sessions established`);

    // ── 3. THE CONTROL — session B refreshes fine BEFORE the reset ──────────
    const refresh = async (token) => json(await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: anonHeaders, body: JSON.stringify({ refresh_token: token }),
    }));
    const control = await refresh(sessionB.refresh_token);
    if (control.status !== 200 || !control.body?.refresh_token) {
      unknown(
        `the CONTROL refresh failed BEFORE any reset (HTTP ${control.status}).`,
        'So a rejection after the reset would prove nothing about the reset. ' +
          JSON.stringify(control.body).slice(0, 300),
      );
    }
    // Rotation is on live, so B's live token is the one the control just minted.
    const bToken = control.body.refresh_token;
    console.log(`${NAME}: CONTROL ok — session B refreshed before the reset, so the probe works`);

    // ── 4. the reset, driven exactly as the emailed link drives it ──────────
    const link = await json(await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ type: 'recovery', email }),
    }));
    if (link.status !== 200) {
      unknown(`could not mint a recovery link (HTTP ${link.status}).`, JSON.stringify(link.body).slice(0, 300));
    }
    const hashed = link.body?.hashed_token ?? link.body?.properties?.hashed_token;
    if (!hashed) unknown('the recovery link carried no hashed_token, so the reset could not be driven.');

    const verified = await json(await fetch(`${url}/auth/v1/verify`, {
      method: 'POST', headers: anonHeaders, body: JSON.stringify({ type: 'recovery', token_hash: hashed }),
    }));
    if (verified.status !== 200 || !verified.body?.access_token) {
      unknown(`the recovery token did not yield a session (HTTP ${verified.status}).`, JSON.stringify(verified.body).slice(0, 300));
    }
    const updated = await json(await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: { ...anonHeaders, Authorization: `Bearer ${verified.body.access_token}` },
      body: JSON.stringify({ password: newPassword }),
    }));
    if (updated.status !== 200) {
      unknown(`the password was not actually changed (HTTP ${updated.status}).`, JSON.stringify(updated.body).slice(0, 300));
    }
    console.log(`${NAME}: password reset through the recovery flow`);

    // ── 5. THE SUBJECT — session B must now be dead ─────────────────────────
    const after = await refresh(bToken);
    if (after.status === 200 && after.body?.access_token) {
      console.error(`${NAME}: THE OTHER SESSION SURVIVED THE RESET.`);
      console.error(`  Session B's refresh token was still accepted (HTTP ${after.status}) after the password was reset.`);
      console.error('  That is the eviction case in O-AUTH-PASSWORD-RESET-HARDENING\'s `blocks:` line: an');
      console.error('  intruder holding a session is not removed by the account holder resetting the password.');
      process.exitCode = 1;
      return;
    }
    console.log(`${NAME}: SUBJECT ok — session B's refresh was REJECTED (HTTP ${after.status})`);
    console.log('');
    console.log(`${NAME}: PASS — a reset revokes the other session's refresh token, and the control proves the`);
    console.log('  probe could see a live session before it did. (Access tokens already issued remain valid');
    console.log('  until jwt_exp by design; that layer is out of this ruling\'s scope and is not asserted here.)');
  } finally {
    // ⚠️ ALWAYS. A probe that leaves a real account behind on the production
    // auth project is worse than no probe.
    if (userId) {
      const del = await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders });
      console.log(`${NAME}: probe user deleted (HTTP ${del.status})`);
      if (!del.ok) {
        console.error(`${NAME}: ⚠️ THE PROBE USER WAS NOT DELETED (HTTP ${del.status}). Remove ${email} by hand.`);
        process.exitCode = Math.max(process.exitCode ?? 0, 2);
      }
    }
  }
};

try {
  await main();
} catch (e) {
  if (!(e instanceof Halt)) {
    console.error(`${NAME}: ✗ COVERAGE LOST — the probe threw (${e?.message ?? e}).`);
    console.error('  Nothing was proved. UNKNOWN, not a pass.');
    process.exitCode = 2;
  }
}
