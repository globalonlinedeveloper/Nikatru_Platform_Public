// Provisions a throwaway, PRE-CONFIRMED Supabase user for the live E2E run and
// emails/password/user_id AND a single-use magic-link token_hash back to the
// workflow via $GITHUB_OUTPUT. The token is how the driver signs in once Box A
// enforces Turnstile — see the block above the generate_link call.
//
// Uses the GoTrue admin API (`email_confirm: true` skips the confirmation mail —
// the project has email confirmation ON) with the service-role key. No SDK: Node
// 20 global fetch only. The user is deleted again by purge.mjs after the run.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const url = need('SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');

// GoTrue rejects @example.com; use a clearly-labelled @nikatru.com test address.
const email = `subly-e2e+${Date.now()}@nikatru.com`;
const password = `E2e${randomBytes(24).toString('hex')}`; // 51 chars, alphanumeric
console.log(`::add-mask::${password}`);

const res = await fetch(`${url}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});

if (!res.ok) {
  console.error(`Provision failed: HTTP ${res.status}\n${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
const userId = body.id ?? body.user?.id;
if (!userId) {
  console.error(`No user id in GoTrue response:\n${JSON.stringify(body)}`);
  process.exit(1);
}

const out = process.env.GITHUB_OUTPUT;
if (!out) {
  console.error('GITHUB_OUTPUT is not set — cannot pass credentials to the run');
  process.exit(1);
}
// ── THE CAPTCHA-PROOF LOGIN PATH ────────────────────────────────────────────
// 🔴 WHY A TOKEN AND NOT THE PASSWORD, MEASURED 2026-09-04. Box A enforces
// Cloudflare Turnstile, and `token?grant_type=password` is one of the six gated
// routes — so the moment SUPABASE_URL moves there, a UI login by typing
// credentials is refused with `captcha_failed` before the password is even
// checked. A headless driver cannot solve a Turnstile challenge; that is what a
// Turnstile challenge is for.
//
// `/verify` is NOT gated (measured, auth-cutover.md §4.7) and `admin/generate_link`
// mints a token for it, so the run authenticates the way an emailed link does.
// Verified end to end against Box A BEFORE this was written:
//   admin/users(email_confirm) -> generate_link{magiclink} -> /verify{magiclink}
//   with the ANON key -> HTTP 200, session, correct user, refresh token present.
//   Replaying the same token -> HTTP 403. It is SINGLE USE, so there is exactly
//   one login per provisioned user; both legs of the suite log in once, which is
//   why one token each is enough.
//
// ⚠️ The ANON key is the one the browser carries. This script holds the
// service-role key and the app never sees it.
const linkRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  },
  body: JSON.stringify({ type: 'magiclink', email }),
});

if (!linkRes.ok) {
  console.error(`generate_link failed: HTTP ${linkRes.status}\n${await linkRes.text()}`);
  process.exit(1);
}

const link = await linkRes.json();
const tokenHash = link.hashed_token;
if (!tokenHash) {
  // Fail HERE rather than emit an empty define. An empty one sends the driver
  // back to the password form, where after the cutover it dies on a captcha
  // with a message that says nothing about a missing token.
  console.error(`No hashed_token in generate_link response (keys: ${Object.keys(link).sort().join(', ')})`);
  process.exit(1);
}
console.log(`::add-mask::${tokenHash}`);

appendFileSync(out, `email=${email}\n`);
appendFileSync(out, `password=${password}\n`);
appendFileSync(out, `user_id=${userId}\n`);
appendFileSync(out, `token_hash=${tokenHash}\n`);

console.log(`Provisioned confirmed E2E user ${email} (id ${userId}).`);

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}
