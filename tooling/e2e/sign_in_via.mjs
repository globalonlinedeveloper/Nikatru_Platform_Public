#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// sign_in_via.mjs — HOW THE WEB E2E SIGNS IN, decided and then graded
// (train st-e2e-parity · EN-08, run by .github/workflows/e2e.yml).
//
// Until 2026-10-01 the live web suite signed in with a harness-minted one-time
// token (integration_test/magic_link_sign_in.dart) and never through the form,
// so no run proved the front door. A headless browser cannot solve a REAL
// Turnstile widget, but Cloudflare's always-pass TEST site keys answer without a
// person, and a stack whose GoTrue holds the matching test secret (a sandbox)
// accepts that answer. So:
//
//   --derive  prints E2E_SIGN_IN=form when the run's TURNSTILE_SITE_KEY is an
//             always-pass test key, or the stack has no captcha gate
//             (E2E_EXPECT_CAPTCHA_GATE=no); otherwise E2E_SIGN_IN=token.
//   --grade <drive.log>
//             a `form` run must print `NK_E2E step=sign-in via=form` and no
//             `via=harness-token`: a session that came from the harness token
//             is a finding (exit 1). A `token` run prints a ⬜ note, never a pass
//             of the front door.
//
// Exit 0 = decided / graded green · 1 = a finding · 2 = could not decide.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Cloudflare's documented always-PASS Turnstile site keys (visible, invisible). */
export const TURNSTILE_PASS_TEST_KEYS = Object.freeze(['1x00000000000000000000AA', '1x00000000000000000000BB']);
export const FORM_LINE = 'NK_E2E step=sign-in via=form';
export const TOKEN_LINE = 'NK_E2E step=sign-in via=harness-token';

/** PURE. `form` | `token`, or null when the inputs cannot decide. */
export function deriveSignIn({ siteKey, captchaGate }) {
  if (captchaGate !== 'yes' && captchaGate !== 'no') return null;
  if (captchaGate === 'no') return 'form';
  return TURNSTILE_PASS_TEST_KEYS.includes(String(siteKey ?? '').trim()) ? 'form' : 'token';
}

/** PURE. The problems with [log] for a run that expected [via]. */
export function gradeSignIn(log, via) {
  const text = String(log ?? '');
  const problems = [];
  if (via === 'form') {
    if (!text.includes(FORM_LINE)) problems.push(`no "${FORM_LINE}" — the full walk did not sign in through the form`);
    if (text.includes(TOKEN_LINE) || text.includes('via=harness-token')) {
      problems.push('the session came from the harness token in a run that expected the form');
    }
  } else if (via === 'token') {
    if (!text.includes(TOKEN_LINE) && !text.includes(FORM_LINE)) problems.push('the drive printed no sign-in line at all');
  } else {
    problems.push(`E2E_SIGN_IN=${JSON.stringify(via ?? null)} is neither form nor token`);
  }
  return problems;
}

function main(argv, env) {
  if (argv[0] === '--derive') {
    const via = deriveSignIn({ siteKey: env.TURNSTILE_SITE_KEY, captchaGate: env.E2E_EXPECT_CAPTCHA_GATE });
    if (!via) {
      console.error(`sign_in_via: E2E_EXPECT_CAPTCHA_GATE=${JSON.stringify(env.E2E_EXPECT_CAPTCHA_GATE ?? null)} cannot decide how the walk signs in`);
      return 2;
    }
    console.log(`E2E_SIGN_IN=${via}`);
    return 0;
  }
  if (argv[0] === '--grade' && argv[1]) {
    const path = resolve(argv[1]);
    let log;
    try {
      log = readFileSync(path, 'utf8');
    } catch {
      console.error(`sign_in_via: no drive log at ${path}`);
      return 2;
    }
    const problems = gradeSignIn(log, env.E2E_SIGN_IN);
    if (problems.length) {
      for (const p of problems) console.error(`FAIL ${p}`);
      return 1;
    }
    if (env.E2E_SIGN_IN === 'token') console.log('⬜ sign_in_via: this run signed in with the harness token — the form was NOT walked (a real Turnstile key)');
    else console.log('ok  sign_in_via: the full walk signed in through the form');
    return 0;
  }
  console.error('usage: node tooling/e2e/sign_in_via.mjs --derive | --grade <drive.log>');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2), process.env));
