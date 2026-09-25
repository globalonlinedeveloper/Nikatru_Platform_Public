// Derives the two facts the live E2E run is graded on, and hands them to every
// later step through $GITHUB_ENV. The derivation itself is
// `deriveExpectation` in tooling/e2e/auth_target_expectation.mjs; this file is
// only its I/O: one env read, one file read, two lines written.
//
//   E2E_STACK          hosted | selfhosted — the captcha posture to expect
//   E2E_WORKERS_TRUST  yes | no — whether the deployed Workers trust this run's
//                      issuer: the run's SUPABASE_URL origin equals
//                      tooling/platform-register.json vars.SUPABASE_URL at the
//                      checked-out sha, the value assert-platform-register LIMB 5
//                      holds equal to all three wrangler configs.
//   E2E_EXPECT_CAPTCHA_GATE  yes | no — E2E_STACK spelt the way app_test.dart's
//                      required dart-define reads it (`yes` for selfhosted).
//
// Why a step and not a target name: the Phase 5 cutover rotates the repo secrets
// (C6) BEFORE the switch commit moves vars.SUPABASE_URL (C7), so between the two
// the default run is on a captcha-ON stack the Workers do not trust yet. A name
// cannot say that; the URL and the register together do, at every point of the
// cutover and of a rollback, with no e2e edit inside the window.
//
// 🔴 THE URL IS A MASKED SECRET AND IS NEVER PRINTED. The step prints the words
// only. An underivable run (no URL, an unreadable register, not exactly one
// vars.SUPABASE_URL) is exit 2, "could not decide what to expect", and writes
// nothing — so every consumer downstream refuses too, never defaults.
//
// Env: SUPABASE_URL (the chosen secret set's), GITHUB_ENV (set by Actions).
// Argv: --register <path> overrides tooling/platform-register.json (tests).
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveExpectation } from './auth_target_expectation.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = process.argv.indexOf('--register');
const given = at === -1 ? null : process.argv[at + 1];
if (at !== -1 && (given === undefined || given.startsWith('-'))) {
  console.error('could not decide what to expect: --register needs a file path after it. Exit 2.');
  process.exit(2);
}
const registerPath = given === null ? join(REPO, 'tooling', 'platform-register.json') : resolve(given);

let registerText = '';
try {
  registerText = readFileSync(registerPath, 'utf8');
} catch (e) {
  console.error(`could not decide what to expect: the register could not be read (${e.code ?? e.name}). Exit 2.`);
  process.exit(2);
}

const derived = deriveExpectation(process.env.SUPABASE_URL, registerText);
if (derived.why) {
  console.error(`::error title=E2E cannot decide what to expect::${derived.why}`);
  process.exit(2);
}

const envFile = process.env.GITHUB_ENV;
if (!envFile) {
  console.error('could not decide what to expect: GITHUB_ENV is unset, so nothing downstream would read the facts. Exit 2.');
  process.exit(2);
}
const captchaGate = derived.stack === 'selfhosted' ? 'yes' : 'no';
appendFileSync(
  envFile,
  `E2E_STACK=${derived.stack}\nE2E_WORKERS_TRUST=${derived.trust}\nE2E_EXPECT_CAPTCHA_GATE=${captchaGate}\n`,
);
console.log(`E2E_STACK=${derived.stack}`);
console.log(`E2E_WORKERS_TRUST=${derived.trust}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `Expecting: stack **${derived.stack}**, Workers trust this run's issuer: **${derived.trust}**\n`,
  );
}
