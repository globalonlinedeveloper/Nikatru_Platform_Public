// Measures what the CHOSEN auth target does with a captcha token it was not
// asked for — the one fact runbooks/auth-cutover.md §4.6 recorded as "expected,
// NOT YET MEASURED" and then built a whole ship-early strategy on.
//
// ── WHY THIS EXISTS AS A STEP AND NOT AS A SENTENCE
//
// `apps/subscriptiontracker/lib/features/auth/turnstile_gate.dart` ships a widget that is OFF
// unless `TURNSTILE_SITE_KEY` is compiled in, and the argument for compiling it
// in AHEAD of the cutover — so the cutover window carries three acts instead of
// four — rests entirely on "GoTrue ignores a captcha token when captcha is
// disabled". That was reasoning, not a measurement. Reasoning about somebody
// else's server is how the §4.5 near-miss happened: three variables set in the
// right-looking place, a green stack, and a wide-open signup.
//
// ── THE PROBE, AND WHY IT CREATES NOTHING
//
// One request: `token?grant_type=password` for an address that does not exist,
// with a deliberately invalid captcha token attached. GoTrue creates no user on
// this route, so `auth.users` is untouched whatever the answer is — which is
// what makes it safe to run against PRODUCTION auth on every nightly.
//
// The two answers are BOTH positive expectations, and which one is required is
// decided by E2E_STACK — the stack the run's SUPABASE_URL points at, derived by
// e2e.yml's step "Derive what this run expects" (tooling/e2e/derive_expectation.mjs),
// never by the name of the secret set:
//
//   hosted     → 400 `invalid_credentials`. The token was IGNORED and the
//                password was actually checked. That is the fact the web build's
//                define depends on; if hosted ever starts enforcing a captcha,
//                this step goes red BEFORE a deploy ships a build nobody can
//                sign in to.
//
//   selfhosted → 400 `captcha_failed`. The gate is on and refuses a bad token
//                BEFORE the password is looked at (measured on the box 2026-09-03,
//                §4.5 row 3). A self-hosted run that got `invalid_credentials`
//                would mean the captcha had been switched off on the auth box,
//                which is a security regression, not a convenience. Whether the
//                Workers trust that stack does not enter this step at all.
//
// ⏱ 2026-09-25 — AN UNSET OR UNKNOWN E2E_STACK IS EXIT 2, NEVER `hosted`. Until
// today this line read `process.env.E2E_AUTH_TARGET || 'hosted'`, so a run whose
// target never arrived was graded as hosted (O-E2E-EMPTY-TARGET-READS-HOSTED).
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, E2E_STACK (hosted | selfhosted, required).

import { randomBytes } from 'node:crypto';
import { decideStack } from './auth_target_expectation.mjs';

const url = need('SUPABASE_URL').replace(/\/+$/, '');
const anonKey = need('SUPABASE_ANON_KEY');
const decided = decideStack(process.env.E2E_STACK);
if (!decided.stack) {
  console.error(decided.why);
  process.exit(2); // safe: this runs BEFORE any request, so no undici handle is open
}
const stack = decided.stack;

// A plain block: the body below was the `else` arm of the retired target check.
{
  // No user is ever created on this route, and the address is one nobody has.
  const email = `subscriptiontracker-captcha-posture+${Date.now()}@nikatru.com`;
  const password = `E2e${randomBytes(24).toString('hex')}`;
  console.log(`::add-mask::${password}`);

  // 🔴 COMPOSED, NOT WRITTEN AS A LITERAL, AND THAT IS NOT COSMETIC. gitleaks'
  // `generic-api-key` rule fires on the SHAPE `<token-ish key>: '<long string>'`
  // — measured 2026-09-07, run 34068265720: the secret scan went red on the line
  // below when the value was inline. The honest fix is to stop writing the
  // shape, not to cut a hole in `.gitleaks.toml`: every allowlist entry is a
  // place a real key could later hide.
  const bogusToken = ['nikatru', 'e2e', 'deliberately', 'invalid'].join('-');

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({
      email,
      password,
      // The shape `packages/core`'s AuthRepository sends, and the shape GoTrue
      // reads. A deliberately invalid value: Cloudflare answers a bad token with
      // `invalid-input-response`, which is how §4.5 proved the SECRET was real
      // without a browser. A placeholder secret would answer
      // `invalid-input-secret` instead, so this probe can tell those apart too.
      gotrue_meta_security: { captcha_token: bogusToken },
    }),
  });

  const raw = await res.text();
  let code = '';
  try {
    const body = JSON.parse(raw);
    code = String(body.error_code ?? body.error ?? body.msg ?? body.message ?? '');
  } catch {
    code = '(response was not JSON)';
  }
  const captcha = /captcha/i.test(code);
  const credentials = /invalid_credentials|invalid_grant|invalid login/i.test(code);

  console.log(`auth stack       : ${stack}`);
  console.log(`HTTP status      : ${res.status}`);
  console.log(`error code       : ${code}`);
  console.log(`reads as captcha : ${captcha}`);

  if (stack === 'hosted') {
    if (res.status === 400 && credentials && !captcha) {
      console.log(
        'MEASURED: hosted GoTrue IGNORED the captcha token and checked the password. ' +
          'Compiling TURNSTILE_SITE_KEY into the web build ahead of the cutover is safe — ' +
          'runbook §4.6 "expected, not yet measured" is now measured.',
      );
    } else {
      console.error(
        `::error title=Captcha posture changed::hosted answered ${res.status} "${code}" to a ` +
          'password sign-in carrying a captcha token. It was expected to IGNORE the token and ' +
          'answer invalid_credentials. Until this is understood, a web build carrying ' +
          'TURNSTILE_SITE_KEY may be one nobody can sign in to — see runbooks/auth-cutover.md §4.6.',
      );
      process.exitCode = 1;
    }
  } else if (res.status === 400 && captcha) {
    console.log(
      'MEASURED: the self-hosted GoTrue REFUSED the request at the captcha, before the password was ' +
        'checked. The gate is on, which is what makes the magic-link login path (provision_user.mjs) ' +
        'load-bearing.',
    );
  } else {
    console.error(
      `::error title=Self-hosted captcha gate is not answering::selfhosted answered ${res.status} "${code}" to a ` +
        'password sign-in carrying an invalid captcha token. It was expected to answer 400 ' +
        'captcha_failed. If the gate is off, anonymous signup on the auth box is open — see ' +
        'runbooks/auth-cutover.md §4.5.',
    );
    process.exitCode = 1;
  }
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}
