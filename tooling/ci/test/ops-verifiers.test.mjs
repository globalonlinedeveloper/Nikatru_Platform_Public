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
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareProviders, declared } from '../../ops/verify-auth-providers.mjs';
import { expectedMonitors } from '../../ops/monitor-register.mjs';
import { KILL_MS, serveSilence, runBounded } from './fixtures/silent-server.mjs';

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
      // ⏱ 2026-09-25: the second look's 15 s gaps (row O-OPS-PROBE-US-EDGE-STALL)
      // shortened to 0 — its plan is proven with a recorded sleep in
      // ops-bounded-retry.test.mjs B13, not by spending a minute per case here.
      OPS_SECOND_LOOK_GAP_MS: '0',
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
    // The default root IS this repo: the CLI reads what the tree ships.
    assert.deepEqual(declared(REPO), d);
  });

  test('declared(root) reads THAT root — a fixture declaring google ON parses as such; a reshaped one is null', () => {
    // auth-cutover-preflight.mjs C3 passes the root it was pointed at, so this
    // seam must read the given tree and not fall back to the module's own.
    const tmp = mkdtempSync(join(tmpdir(), 'nikatru-declared-'));
    try {
      const dart = join(tmp, 'packages', 'auth_supabase', 'lib', 'src', 'auth_providers.dart');
      mkdirSync(dirname(dart), { recursive: true });
      writeFileSync(dart, 'class AuthProviders {\n  static const AuthProviders configured = AuthProviders(\n    apple: true,\n    google: true,\n  );\n}\n');
      assert.deepEqual(declared(tmp), { apple: true, google: true });
      writeFileSync(dart, 'class AuthProviders {\n  static const AuthProviders configured = AuthProviders.fromEnvironment();\n}\n');
      assert.equal(declared(tmp), null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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

  test('🔴 verify-monitors on an unreachable instance exits 2, NOT 127 and NOT 1', () => {
    // THIS IS THE 127 CASE, AND IT IS THE REASON THIS FILE EXISTS. Asserting
    // merely "non-zero" would have passed against the libuv crash; the contract
    // is that the code is one this file can name.
    const { code, out } = run('verify-monitors.mjs', {
      GLITCHTIP_TOKEN: 'fixture-token',
      GLITCHTIP_URL: CLOSED,
      GLITCHTIP_ORG: 'nikatru',
    });
    assert.notEqual(code, 127, `crashed instead of exiting cleanly:\n${out}`);
    // ⏱ 2026-09-11 — exactly 2. "1 or 2" admitted the defect this file now
    // refuses: an instance that could not be reached reported as monitor DRIFT.
    assert.equal(code, 2, `an unreachable instance is COULD NOT LOOK (2), never drift (1):\n${out}`);
    assert.match(out, /COULD NOT LOOK/);
  });

  test('🔴 verify-alarm-chains on an unreachable instance exits 2, NOT 127 and NOT 1', () => {
    const { code, out } = run('verify-alarm-chains.mjs', {
      GLITCHTIP_TOKEN: 'fixture-token',
      GLITCHTIP_URL: CLOSED,
      GLITCHTIP_ORG: 'nikatru',
    });
    assert.notEqual(code, 127, `crashed instead of exiting cleanly:\n${out}`);
    assert.equal(code, 2, `an unreachable instance is COULD NOT LOOK (2), never a broken chain (1):\n${out}`);
    assert.match(out, /COULD NOT LOOK/);
  });

  // ⏱ 2026-09-11 · A GLITCHTIP THAT ANSWERS, BADLY. The closed port above never
  // produces an HTTP status, so a 401, a 5xx and a changed answer shape — the
  // three ways an expired token or an unwell Oracle box actually shows up — were
  // exit 1 in both files, the code each gives a real finding. These serve those
  // answers from a local server. ASYNC SPAWN, NOT spawnSync: the server lives in
  // this process, and a synchronous spawn would block the event loop it answers on.
  const serve = async (answer) => {
    const seen = [];
    const server = createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization ?? null });
      const [status, body] = answer(req.url);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    return { url: 'http://127.0.0.1:' + server.address().port, seen, close: () => new Promise((ok) => server.close(ok)) };
  };
  const runServed = (script, env) =>
    new Promise((ok) => {
      const child = spawn(process.execPath, [join(OPS, script)], { cwd: REPO, env: { ...process.env, OPS_SECOND_LOOK_GAP_MS: '0', ...env } });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('close', (code) => ok({ code, out }));
    });
  const glitchtipAt = (url) => ({ GLITCHTIP_TOKEN: 'fixture-token', GLITCHTIP_URL: url, GLITCHTIP_ORG: 'nikatru' });

  // ⏱ 2026-09-22 · A GLITCHTIP THAT ACCEPTS AND NEVER ANSWERS (row
  // O-OPS-READER-NO-CEILING). Every shape above ANSWERS. A socket that is
  // accepted and then left silent gives no status, no error and no end, and it
  // held a reader until the job's timeout-minutes. OPS_REQUEST_TIMEOUT_MS shortens
  // the shared per-request ceiling (it can only shorten it), so the case ends in
  // seconds. The child is killed at KILL_MS and the case has its own { timeout },
  // so a missing ceiling is a red case, never a hung suite. ⏱ 2026-09-24: the
  // server and the runner live in fixtures/silent-server.mjs, shared with
  // prod-provenance.test.mjs.
  const assertSilenceEndsInsideCeiling = async (script) => {
    const g = await serveSilence();
    try {
      const t0 = Date.now();
      // ⏱ 2026-09-25: OPS_SECOND_LOOK_GAP_MS=0 — the second look's 15 s gaps
      // would otherwise outlast KILL_MS; the ceiling under test is unchanged.
      const { code, signal, out } = await runBounded(join(OPS, script), {
        ...glitchtipAt(g.url),
        OPS_REQUEST_TIMEOUT_MS: '300',
        OPS_SECOND_LOOK_GAP_MS: '0',
      });
      const took = Date.now() - t0;
      assert.equal(signal, null, `killed after ${took} ms: the read had no per-request ceiling\n${out}`);
      assert.ok(g.seen.length >= 1, 'the script never reached the silent server:\n' + out);
      assert.equal(code, 2, out);
      assert.match(out, /COULD NOT LOOK/);
      assert.match(out, /per-request ceiling/, 'the line says WHY it could not look');
      assert.match(out, /SECOND LOOK: .*all 4 second-look attempt\(s\)/, 'the second look ran, and got nothing either');
    } finally {
      await g.close();
    }
  };
  test('🔴 verify-monitors.mjs against a server that never answers is exit 2 inside the ceiling, not a hang', { timeout: KILL_MS + 10_000 }, async () => {
    await assertSilenceEndsInsideCeiling('verify-monitors.mjs');
  });
  test('🔴 verify-alarm-chains.mjs against a server that never answers is exit 2 inside the ceiling, not a hang', { timeout: KILL_MS + 10_000 }, async () => {
    await assertSilenceEndsInsideCeiling('verify-alarm-chains.mjs');
  });

  for (const [what, answer] of [
    ['a 401 (the token is refused)', () => [401, { detail: 'Invalid token.' }]],
    ['a 503 (the Oracle box is unwell)', () => [503, { detail: 'unavailable' }]],
    ['an answer that is not a list (the API shape changed)', () => [200, { detail: 'not a list' }]],
  ]) {
    test('🔴 verify-monitors on ' + what + ' is exit 2 — COULD NOT LOOK, not drift', async () => {
      const g = await serve(answer);
      try {
        const { code, out } = await runServed('verify-monitors.mjs', glitchtipAt(g.url));
        // CONTROL, in the same case: the served answer was really what the script
        // read, with the token — so the exit below comes from that answer and not
        // from a closed port or a skipped request.
        assert.ok(g.seen.some((r) => r.url.startsWith('/api/0/organizations/nikatru/monitors/') && r.auth === 'Bearer fixture-token'), 'the script never asked the served instance:\n' + out);
        assert.equal(code, 2, out);
        assert.match(out, /COULD NOT LOOK/);
      } finally {
        await g.close();
      }
    });

    test('🔴 verify-alarm-chains on ' + what + ' is exit 2 — COULD NOT LOOK, not a broken chain', async () => {
      const g = await serve(answer);
      try {
        const { code, out } = await runServed('verify-alarm-chains.mjs', glitchtipAt(g.url));
        assert.ok(g.seen.some((r) => r.url.startsWith('/api/0/organizations/') && r.auth === 'Bearer fixture-token'), 'the script never asked the served instance:\n' + out);
        assert.equal(code, 2, out);
        assert.match(out, /COULD NOT LOOK/);
      } finally {
        await g.close();
      }
    });
  }

  test('🔴 verify-alarm-chains: a project whose ALERTS cannot be read is exit 2, and a real broken chain still outranks it as 1', async () => {
    // The fixture is built FROM THE REAL LEDGER so every other limb is silent: each
    // expected monitor is live (limb D), attached to a project (limb A) whose chain
    // the ledger records as observed (limb C). Only the alert reads differ.
    const ledger = JSON.parse(readFileSync(join(OPS, 'alarm-chains.json'), 'utf8'));
    const org = ledger.org;
    const observed = Object.entries(ledger.chainsObserved ?? {}).filter(([, o]) => o?.date && o?.evidence).map(([slug]) => slug);
    assert.ok(observed.length > 0, 'the ledger records no observed chain, so this fixture cannot be built');
    const slug = observed[0];
    // ⏱ 2026-09-26 (E-b2): the canary expects the host rows' monitor ids too, so the
    // fixture serves the same union it reads (tooling/ops/monitor-register.mjs).
    const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'monitor-register.json'), 'utf8'));
    const union = expectedMonitors(register, ledger);
    assert.deepEqual(union.problems, [], 'the real register and ledger do not form a clean canary list, so this fixture cannot be built');
    const monitors = union.expected.map((row) => ({ id: Number(row.id), name: row.name, projectID: 1 }));
    const answerWith = (extra) => (url) => {
      if (url.startsWith('/api/0/organizations/' + org + '/monitors/')) return [200, [...monitors, ...extra.monitors]];
      if (url.startsWith('/api/0/organizations/' + org + '/projects/')) return [200, [{ id: 1, slug, name: slug }, ...extra.projects]];
      if (url.startsWith('/api/0/projects/' + org + '/' + slug + '/alerts/')) return [503, { detail: 'unavailable' }];
      if (url.startsWith('/api/0/projects/' + org + '/zz-broken/alerts/')) return [200, []];
      return [404, { detail: 'Not found.' }];
    };
    const onlyUnread = await serve(answerWith({ monitors: [], projects: [] }));
    try {
      const r = await runServed('verify-alarm-chains.mjs', glitchtipAt(onlyUnread.url));
      assert.ok(onlyUnread.seen.some((x) => x.url.startsWith('/api/0/projects/' + org + '/' + slug + '/alerts/')), 'limb B never read an alert list:\n' + r.out);
      assert.ok(r.out.includes('ALERTS UNREADABLE: project ' + slug), r.out);
      assert.doesNotMatch(r.out, /COVERAGE LOST: expected monitor|NO PROJECT|DANGLING PROJECT|NEVER OBSERVED/, 'the fixture tripped another limb, so the exit below would not come from the alert read');
      assert.equal(r.code, 2, r.out);
    } finally {
      await onlyUnread.close();
    }
    const withBroken = await serve(answerWith({ monitors: [{ id: 999999, name: 'fixture', projectID: 2 }], projects: [{ id: 2, slug: 'zz-broken', name: 'zz-broken' }] }));
    try {
      const r = await runServed('verify-alarm-chains.mjs', glitchtipAt(withBroken.url));
      assert.ok(r.out.includes('ALERTS UNREADABLE: project ' + slug), r.out);
      assert.match(r.out, /NO UPTIME RECIPIENT: project zz-broken/, r.out);
      assert.equal(r.code, 1, 'a chain that WAS read and is broken must still be exit 1:\n' + r.out);
    } finally {
      await withBroken.close();
    }
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
