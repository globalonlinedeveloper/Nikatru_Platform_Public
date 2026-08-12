// ─────────────────────────────────────────────────────────────────────────────
// ops-verifiers.test.mjs — the four live checks that ops-watch.yml now runs on a
// cadence must each be able to FAIL, and to say "I could not look" as a THIRD
// thing.
//
// [pipeline F-10] These four were session-only until 2026-08-11, when
// GLITCHTIP_TOKEN became a repository secret and `ops-watch.yml` grew a
// `glitchtip` job. The moment a workflow runs a script, `assert-guard-coverage`
// requires it to have a recorded failing case — and it was right to: all four
// had only ever been run by hand, against a healthy live instance, by somebody
// watching the output. **A guard exercised only on its happy path is a guard
// whose failure behaviour is a guess.**
//
// 🔴 THAT IS NOT HYPOTHETICAL HERE. The exit contract of three of these was
// BROKEN until 2026-08-05 and nobody had exercised it: with a bad token
// `verify-monitors` and `verify-alarm-chains` returned **127**, not 1, because
// `process.exit()` while an undici keep-alive handle is open crashes libuv on
// Windows. The no-token path returned 2 correctly only because it runs BEFORE
// any request — so every path that had actually touched the network was broken,
// and the happy path was fine. **The failure path of a checker is the path
// nobody exercises.** The cases below exercise it, and they assert the CODE
// rather than merely "non-zero", because 127 is non-zero too.
//
// ⚠️ NOTHING HERE TOUCHES THE LIVE INSTANCE OR THE NETWORK.
// The judgement is tested by importing the pure function; the exit contract is
// tested by pointing each script at a closed port or withholding its credential.
// 🔴 A FIXTURE HTTP SERVER WAS TRIED FIRST AND IS THE WRONG ANSWER: the
// verifiers use undici, which keeps sockets alive, so `server.close()` waits for
// connections that never end and the `after` hook never resolves. The suite hung
// for ten minutes with every assertion already green — a passing test that never
// reports, which is worse than a failing one. Hence `compareProviders`.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareProviders, declared } from '../../ops/verify-auth-providers.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const OPS = join(REPO, 'tooling', 'ops');

/// A port nothing listens on, on every runner. Reaching for it is how "the
/// endpoint was unreachable" is driven without a fixture server.
const CLOSED = 'http://127.0.0.1:1';

/// Run a verifier with a CONTROLLED environment.
///
/// 🔴 THE ENVIRONMENT IS BUILT FROM SCRATCH, NOT INHERITED. Two of these fall
/// back to the local vault when their env var is absent, so a test that merely
/// omitted a variable would pass on CI (no `.claude/`) and fail on the owner's
/// laptop (vault present) — or worse, quietly contact the real project. Every
/// case below therefore SETS what it wants rather than trusting absence.
function run(script, env = {}, args = []) {
  const r = spawnSync(process.execPath, [join(OPS, script), ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('verify-auth-providers — the judgement, both directions', () => {
  test('AGREEMENT yields no problems', () => {
    assert.deepEqual(
      compareProviders({
        declared: { apple: false, google: false },
        live: { apple: false, google: false, email: true },
      }),
      [],
    );
  });

  test('🔴 DECLARED ON / SERVER OFF — the original shipped defect', () => {
    // The app renders "Continue with Apple" and Supabase answers 400.
    const problems = compareProviders({
      declared: { apple: true, google: false },
      live: { apple: false, google: false, email: true },
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /DECLARED ENABLED, but the server says disabled/);
  });

  test('🔴 DECLARED OFF / SERVER ON — the direction everyone forgets', () => {
    // Nothing else in the tree would ever say that a provider the owner paid to
    // stand up is being hidden from every user on every platform.
    const problems = compareProviders({
      declared: { apple: false, google: false },
      live: { apple: false, google: true, email: true },
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /DECLARED DISABLED, but the server says ENABLED/);
  });

  test('BOTH wrong yields BOTH problems — one is not allowed to mask the other', () => {
    const problems = compareProviders({
      declared: { apple: true, google: false },
      live: { apple: false, google: true, email: true },
    });
    assert.equal(problems.length, 2);
  });

  test('a MISSING provider key is a problem, not a pass', () => {
    // The subtlest failure: the call succeeded and carried nothing to check.
    // Treating absent as false would silently stop checking.
    const problems = compareProviders({
      declared: { apple: false, google: false },
      live: { email: true },
    });
    assert.equal(problems.length, 2);
    for (const p of problems) assert.match(p, /no boolean `external\./);
  });

  test('the SHIPPING declaration parses, and is what the login screens gate on', () => {
    // Pins the real file. If `AuthProviders.configured` is reshaped so the parse
    // stops finding it, `declared()` returns null and this fails — rather than
    // the guard passing over an unreadable subject.
    const d = declared();
    assert.ok(d, 'AuthProviders.configured did not parse out of auth_providers.dart');
    assert.equal(typeof d.apple, 'boolean');
    assert.equal(typeof d.google, 'boolean');
  });
});

describe('verify-auth-providers — the exit contract', () => {
  test('MISSING credentials are exit 2, never a pass', () => {
    // 🔴 `NIKATRU_VAULT` MUST POINT SOMEWHERE ABSENT OR THIS TEST IS A LIE.
    // The script falls back to the local vault when the env vars are empty, so
    // without this it asserts exit 2 and gets exit 0 on the owner's laptop
    // (vault present → real credentials → the LIVE project contacted) while
    // "passing" on CI only because a runner has no `.claude/`. Measured: the
    // first version of this test failed here for precisely that reason, which
    // is how the seam came to exist.
    const { code, out } = run('verify-auth-providers.mjs', {
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      NIKATRU_VAULT: join(REPO, 'no', 'such', 'vault.env'),
    });
    assert.equal(code, 2, out);
    assert.match(out, /I COULD NOT LOOK/);
  });

  test('an UNREACHABLE endpoint is exit 2 — and does NOT crash as 127', () => {
    const { code, out } = run('verify-auth-providers.mjs', {
      SUPABASE_URL: CLOSED,
      SUPABASE_PUBLISHABLE_KEY: 'fixture-not-a-secret',
    });
    assert.equal(code, 2, out);
    assert.match(out, /I COULD NOT LOOK/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('verify-monitors / verify-alarm-chains — the GlitchTip pair', () => {
  // Both read GLITCHTIP_TOKEN from the environment ONLY — no vault fallback —
  // so an empty value is a deterministic no-credential case on any machine.
  test('verify-monitors without a token is exit 2', () => {
    const { code, out } = run('verify-monitors.mjs', { GLITCHTIP_TOKEN: '' });
    assert.equal(code, 2, out);
    assert.match(out, /GLITCHTIP_TOKEN is not set/);
  });

  test('verify-alarm-chains without a token is exit 2', () => {
    const { code, out } = run('verify-alarm-chains.mjs', { GLITCHTIP_TOKEN: '' });
    assert.equal(code, 2, out);
  });

  test('🔴 verify-monitors on an unreachable instance exits 1 or 2, NOT 127', () => {
    // THIS IS THE 127 CASE, AND IT IS THE REASON THIS FILE EXISTS. Asserting
    // merely "non-zero" would have passed against the libuv crash; the contract
    // is that the code is one this file can name.
    const { code, out } = run('verify-monitors.mjs', {
      GLITCHTIP_TOKEN: 'fixture-token',
      GLITCHTIP_URL: CLOSED,
      GLITCHTIP_ORG: 'nikatru',
    });
    assert.notEqual(code, 127, `crashed instead of exiting cleanly:\n${out}`);
    assert.ok(code === 1 || code === 2, `expected 1 or 2, got ${code}:\n${out}`);
  });

  test('🔴 verify-alarm-chains on an unreachable instance exits 1 or 2, NOT 127', () => {
    const { code, out } = run('verify-alarm-chains.mjs', {
      GLITCHTIP_TOKEN: 'fixture-token',
      GLITCHTIP_URL: CLOSED,
      GLITCHTIP_ORG: 'nikatru',
    });
    assert.notEqual(code, 127, `crashed instead of exiting cleanly:\n${out}`);
    assert.ok(code === 1 || code === 2, `expected 1 or 2, got ${code}:\n${out}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('verify-free-api-scope — it must refuse to check the WRONG account', () => {
  test('a malformed key in the env is exit 2, not a pass', () => {
    // A truncated or quote-wrapped paste looks exactly like a present secret.
    const { code, out } = run('verify-free-api-scope.mjs', {
      PLAY_SERVICE_ACCOUNT_JSON: 'not-json{{',
    });
    assert.equal(code, 2, out);
    assert.match(out, /does not parse as JSON/);
  });

  test('a well-formed key missing a required field is exit 2', () => {
    const { code, out } = run('verify-free-api-scope.mjs', {
      PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account' }),
    });
    assert.equal(code, 2, out);
    assert.match(out, /carries no `client_email`/);
  });

  test('🔴 a key for a DIFFERENT service account is exit 1 — refused, not passed', () => {
    // The case that matters most and is easiest to miss. The secret's value
    // cannot be read from the repo, so nothing local can confirm it holds the
    // key it is believed to hold. Swap it and every project-level probe still
    // answers 403 — the guard would print PASS while asserting that some OTHER
    // account is powerless and saying nothing at all about nikatru-free-api@.
    // It must refuse the subject rather than earn a verdict about a stranger.
    const { code, out } = run('verify-free-api-scope.mjs', {
      PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: 'service_account',
        client_email: 'someone-else@other.iam.gserviceaccount.com',
        private_key: 'not-a-real-key',
      }),
    });
    assert.equal(code, 1, out);
    assert.match(out, /Refusing to check the wrong subject/);
  });
});
