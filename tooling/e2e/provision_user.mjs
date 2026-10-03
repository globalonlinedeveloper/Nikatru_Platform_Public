// Provisions a throwaway, PRE-CONFIRMED Supabase user for the live E2E run and
// emails/password/user_id AND a single-use magic-link token_hash back to the
// workflow via $GITHUB_OUTPUT. The token is how the driver signs in once Box A
// enforces Turnstile — see the block above the generate_link call.
//
// Uses the GoTrue admin API (`email_confirm: true` skips the confirmation mail —
// the project has email confirmation ON) with the service-role key. No SDK: Node
// 20 global fetch only. The user is deleted again by purge.mjs after the run.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and E2E_SWEEP_APP (optional:
//      e2e.yml's `matrix.app`, which MARKS the address as one the stale sweep
//      may remove — tooling/e2e/e2e_email.mjs's header says why only there).
//
// ⏱ 2026-10-03 — 🔴 NO process.exit() AFTER THE FIRST REQUEST (PR #1177 review,
// finding 1). An exit over an open undici handle trips a libuv assertion on
// Windows and the process reports 3221226505 (0xC0000409), not 1. Every exit
// above the create request may call process.exit(); everything below it is
// main(), which RETURNS its code into process.exitCode.

import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { MagicLinkRefused, mintMagicLinkTokenHash } from './magic_link.mjs';
import { E2eEmailRefused, e2eEmail } from './e2e_email.mjs';
import { CredentialOriginRefused, credentialOrigin } from '../ops/credential-origin.mjs';

const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
// ⏱ 2026-09-30 — 🔴 THE SERVICE-ROLE KEY GOES TO ITS ISSUER OR NOWHERE (CodeQL
// #68 audit): SUPABASE_URL is pinned by tooling/ops/credential-origin.mjs before
// the first request — the self-hosted GoTrue, a hosted *.supabase.co project, or
// loopback. Any other value is exit 1, as a missing variable is, and nothing is sent.
let url;
try {
  url = credentialOrigin(need('SUPABASE_URL'), 'supabase');
} catch (e) {
  if (!(e instanceof CredentialOriginRefused)) throw e;
  console.error(`SUPABASE_URL: ${e.message}`);
  process.exit(1);
}

// Checked BEFORE the user is created: an account made with nowhere to write its
// id is an account no purge can find.
const out = process.env.GITHUB_OUTPUT;
if (!out) {
  console.error('GITHUB_OUTPUT is not set — cannot pass credentials to the run');
  process.exit(1);
}

/** The shape GoTrue issues a user id in: a UUID. user_id is written into
 *  $GITHUB_OUTPUT, one output per line, and the purge deletes by it — so an id
 *  carrying a newline would forge outputs of its own (a second `user_id=`, a
 *  `token_hash=`). Held to this shape, as magic_link.mjs holds token_hash to
 *  TOKEN_HASH_SHAPE, no response text but a UUID reaches that file. */
const USER_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GoTrue rejects @example.com; use a clearly-labelled @nikatru.com test address.
// Its shape is tooling/e2e/e2e_email.mjs's, the one tooling/e2e/purge_stale.mjs
// matches when it sweeps a user no always() purge could reach.
let email;
try {
  email = e2eEmail(Date.now(), { sweepApp: process.env.E2E_SWEEP_APP || undefined });
} catch (e) {
  if (!(e instanceof E2eEmailRefused)) throw e;
  console.error(`${e.message}. Exit 1: no user was created.`);
  process.exit(1);
}
const password = `E2e${randomBytes(24).toString('hex')}`; // 51 chars, alphanumeric
console.log(`::add-mask::${password}`);

process.exitCode = await main();

async function main() {
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
    return 1;
  }

  const body = await res.json();
  const userId = body.id ?? body.user?.id;
  if (!userId) {
    console.error(`No user id in GoTrue response:\n${JSON.stringify(body)}`);
    return 1;
  }
  if (typeof userId !== 'string' || !USER_ID_SHAPE.test(userId)) {
    // The length, never the value: it is not a UUID, so nothing vouches for it.
    console.error(`GoTrue returned a user id that is not a UUID (${String(userId).length} characters), so it is never written to a step output`);
    return 1;
  }

  // ⏱ 2026-10-03 — 🔴 THE ID IS WRITTEN THE MOMENT THE USER EXISTS, BEFORE THE MINT.
  // E2E run 37076032926 created the delete-leg user, then died on a 520 from
  // generate_link; `user_id=` was written only after the mint, so the step had no
  // such output, both `if: always()` purges got an empty E2E_USER_ID, purged
  // nothing, and a confirmed throwaway user stayed in production auth (twice,
  // 2026-10-02T23:09Z and 2026-10-03T00:16Z). Writing it here hands the always()
  // purge every user this step created, whatever fails after. GitHub reads the
  // file when the step ends, success or failure. The password and token stay
  // below the mint: neither is any use to a purge.
  appendFileSync(out, `email=${email}\n`);
  appendFileSync(out, `user_id=${userId}\n`);

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
  //
  // The request itself is tooling/e2e/magic_link.mjs, shared with the store
  // capture, which mints one more per drive after its first (a token is single
  // use). An empty token is refused THERE rather than emitted as an empty define:
  // an empty one sends the driver back to the password form, where after the
  // cutover it dies on a captcha with a message that says nothing about a token.
  let tokenHash;
  try {
    tokenHash = await mintMagicLinkTokenHash({ url, serviceKey, email });
  } catch (e) {
    if (!(e instanceof MagicLinkRefused)) throw e;
    console.error(e.message);
    return 1;
  }
  console.log(`::add-mask::${tokenHash}`);

  appendFileSync(out, `password=${password}\n`);
  appendFileSync(out, `token_hash=${tokenHash}\n`);

  console.log(`Provisioned confirmed E2E user ${email} (id ${userId}).`);
  return 0;
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}
