// ─────────────────────────────────────────────────────────────────────────────
// signup-retention.test.mjs — the KV retention seam in
// sites/nikatru/functions/api/subscribe.js must be INERT while no period is
// declared, and must actually set the TTL the moment one is.
//
// [pipeline O-17] tooling/ops/register.json → retention.kv.nikatru-signups.signup
// is the one store in the portfolio holding a contactable identity with no
// expiry. The PERIOD is a policy decision the owner owns; the WIRING is not, and
// this suite is what makes the wiring a fact rather than an intention.
//
// 🔴 WHY THIS TESTS MUTATED COPIES OF THE REAL FILE AND NOT A FIXTURE.
// "A fixture you wrote encodes the same misunderstanding as the guard you
// wrote" — assert-seams-wired.mjs shipped green with its caller check matching
// the function's own declaration, and all six of its fixtures passed. So the
// modules under test here ARE sites/nikatru/functions/api/subscribe.js, read off
// disk, with exactly ONE VALUE substituted — which is precisely the one-line
// change the owner will make. The activated branch is therefore a rehearsal of
// that change, not a model of it.
//
// 🔑 AND WHY THE REAL-FILE CASE DERIVES ITS EXPECTATION INSTEAD OF PINNING null.
// A test asserting "the shipped file declares null" would go RED the day the
// owner declares a period — turning a one-line change into a two-line one and
// making this suite an obstacle to the very decision it exists to enable. So it
// reads the declared value and asserts the file BEHAVES CONSISTENTLY WITH IT.
// That case is correct in both states; the two forced-variant cases below cover
// both branches regardless of what is shipped.
//
// NEGATIVE-TESTED (2026-08-09, real mutations of the real file, restored after):
//   N1 call site reverted to `put(key, JSON.stringify(record))`
//        -> "declares 30 day(s) and the put carried no options" (the wiring test
//           is the one that catches a severed seam; both others stayed green,
//           which is exactly why it exists)
//   N2 helper changed to always return `{ expirationTtl: … }`
//        -> "must be the same two-argument put the site makes today" (arity 3)
//   N3 `SECONDS_PER_DAY` changed 86400 -> 3600
//        -> conversion case red: expected 2592000, got 108000
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SUBSCRIBE_REL = 'sites/nikatru/functions/api/subscribe.js';
const SUBSCRIBE = join(REPO, SUBSCRIBE_REL);

const SECONDS_PER_DAY = 86400;

/** The one line this whole seam turns on. Matched rather than assumed: if the
 *  constant is ever renamed or deleted, every case below would otherwise test a
 *  module that no longer has the seam in it and report green. */
const DECL_RE = /^const SIGNUP_RETENTION_DAYS = ([^;]+);$/m;

let TMP;
let SRC;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-sig-'));
  SRC = readFileSync(SUBSCRIBE, 'utf8');
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** Load subscribe.js with `SIGNUP_RETENTION_DAYS` forced to `literal`.
 *  `.mjs` because a bare `.js` in a temp dir with no package.json is parsed as
 *  CommonJS and the ESM `export` would throw — a failure that looks like a
 *  broken module rather than a broken harness. */
async function loadWithPeriod(literal) {
  assert.match(
    SRC,
    DECL_RE,
    `${SUBSCRIBE_REL} no longer declares \`const SIGNUP_RETENTION_DAYS = …;\`. The seam this suite ` +
      'exists to hold open is gone, and every case below would be testing a module without it.',
  );
  const next = SRC.replace(DECL_RE, `const SIGNUP_RETENTION_DAYS = ${literal};`);
  // Assert the CONSTANT NOW READS the intended literal, not that the bytes
  // changed: forcing `null` onto a file that already ships `null` is a legitimate
  // no-op, and a bytes-changed check turns that into a spurious failure. What
  // must never pass silently is a substitution that did not take.
  const applied = next.match(DECL_RE);
  assert.ok(
    applied && applied[1].trim() === String(literal),
    `substituting ${literal} did not take — the constant now reads \`${applied?.[1]?.trim()}\`.`,
  );
  const file = join(TMP, `subscribe-${literal}-${seq++}.mjs`);
  writeFileSync(file, next);
  return import(pathToFileURL(file).href);
}

/** The real shipped module, unmutated. */
async function loadReal() {
  return import(pathToFileURL(SUBSCRIBE).href);
}

/** What the shipped file declares today: `null`, or a number. */
function declaredPeriod() {
  const m = SRC.match(DECL_RE);
  assert.ok(m, `${SUBSCRIBE_REL} declares no SIGNUP_RETENTION_DAYS`);
  const raw = m[1].trim();
  return raw === 'null' ? null : Number(raw);
}

const request = (email = 'someone@example.test') => ({
  headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => ({ email }),
});

/** A KV double that RECORDS THE ARGUMENT LIST, not just the options object —
 *  the difference between `put(k, v)` and `put(k, v, undefined)` is the whole
 *  claim that the dormant seam changes nothing, and an options-only recorder
 *  cannot see it. */
function recordingEnv() {
  const puts = [];
  return {
    puts,
    SIGNUPS: {
      get: async () => null,
      list: async () => ({ keys: [] }),
      put: async (...args) => {
        puts.push(args);
      },
    },
  };
}

async function signup(mod, env) {
  const res = await mod.onRequestPost({ request: request(), env: { SIGNUPS: env.SIGNUPS } });
  assert.equal(res.status, 200, 'the signup path itself failed, so nothing below is about retention');
  return env.puts;
}

describe('signupPutOptions — the pure half', () => {
  test('no declared period yields NO options object at all', async () => {
    const { signupPutOptions } = await loadReal();
    assert.equal(signupPutOptions(null), undefined);
    // ⚠️ NOT `signupPutOptions(undefined)`. That argument triggers the DEFAULT
    // PARAMETER and so returns whatever the file currently declares — it is the
    // "use the shipped period" call, not the "no period" one. Asserting it
    // returns undefined passes today only because the shipped value is null,
    // and would go red the day the owner declares a period: a test that turns
    // the intended one-line change into a two-line one. Caught by running the
    // owner's change as a mutation (N4 in the header) rather than by reading.
    // The default-parameter path is covered by the shipped-file case below,
    // which derives its expectation instead of pinning it.
  });

  test('a positive number of days converts to seconds', async () => {
    const { signupPutOptions } = await loadReal();
    assert.deepEqual(signupPutOptions(1), { expirationTtl: 86400 });
    assert.deepEqual(signupPutOptions(30), { expirationTtl: 2592000 });
    assert.deepEqual(signupPutOptions(365), { expirationTtl: 31536000 });
  });

  test('values that are not a positive number stay INERT rather than becoming a TTL', async () => {
    const { signupPutOptions } = await loadReal();
    // 🔴 `0` and a negative are the dangerous ones: KV reads a tiny/absent TTL
    // as "expire immediately", so a fat-fingered 0 must mean NO EXPIRY, never
    // "delete the launch list now".
    for (const v of [0, -1, -365, NaN, Infinity, '30', '', true, {}, []]) {
      assert.equal(signupPutOptions(v), undefined, `${JSON.stringify(String(v))} must not produce a TTL`);
    }
  });

  test('a fractional period is rounded to whole seconds', async () => {
    const { signupPutOptions } = await loadReal();
    assert.deepEqual(signupPutOptions(0.5), { expirationTtl: 43200 });
  });
});

describe('the wiring — what the real put actually receives', () => {
  test('DORMANT: with no period the put is the same two-argument call the site makes today', async () => {
    const mod = await loadWithPeriod('null');
    const env = recordingEnv();
    const puts = await signup(mod, env);
    assert.equal(puts.length, 1, 'the signup was not stored at all');
    assert.equal(
      puts[0].length,
      2,
      'with no declared period the write must be the same two-argument put the site makes today — ' +
        `got ${puts[0].length} argument(s): ${JSON.stringify(puts[0].slice(2))}. An options object here means ` +
        'leaving the period undeclared is no longer a no-op.',
    );
    assert.equal(JSON.parse(puts[0][1]).email, 'someone@example.test');
  });

  test('ACTIVATED: one value turns the same call into a TTL\'d write', async () => {
    const mod = await loadWithPeriod('30');
    const env = recordingEnv();
    const puts = await signup(mod, env);
    assert.equal(puts.length, 1);
    assert.equal(
      puts[0].length,
      3,
      'the module declares 30 day(s) and the put carried no options — the seam is declared but NOT WIRED, ' +
        'which is the failure this case exists for: the constant reads like a working switch and changes nothing.',
    );
    assert.deepEqual(puts[0][2], { expirationTtl: 30 * SECONDS_PER_DAY });
  });

  test('the TTL tracks the declared period rather than being a constant', async () => {
    // Two different periods must produce two different TTLs. A hardcoded
    // `expirationTtl` at the call site would satisfy the case above and fail here.
    for (const days of [1, 7, 400]) {
      const mod = await loadWithPeriod(String(days));
      const env = recordingEnv();
      const puts = await signup(mod, env);
      assert.deepEqual(puts[0][2], { expirationTtl: days * SECONDS_PER_DAY }, `period of ${days} day(s)`);
    }
  });

  test('the rate-limit key keeps its own TTL, untouched by the signup seam', async () => {
    // The two puts in this file have DIFFERENT retention rules and different
    // register rows. Wiring one must not disturb the other.
    const mod = await loadWithPeriod('null');
    const src = SRC;
    assert.match(src, /expirationTtl: RATE_WINDOW_SECONDS/, 'the rate-limit put lost its TTL');
    assert.ok(mod.onRequestPost, 'module did not load');
  });
});

describe('the shipped file', () => {
  test('behaves consistently with the period it declares', async () => {
    // Correct whether the owner has declared a period or not — see the header.
    const declared = declaredPeriod();
    const mod = await loadReal();
    const env = recordingEnv();
    const puts = await signup(mod, env);
    assert.equal(puts.length, 1);
    if (declared === null) {
      assert.equal(puts[0].length, 2, `${SUBSCRIBE_REL} declares no period yet writes options — that is not the dormant state.`);
      assert.equal(mod.signupPutOptions(), undefined);
    } else {
      assert.equal(puts[0].length, 3, `${SUBSCRIBE_REL} declares ${declared} day(s) and the put carried no options.`);
      assert.deepEqual(puts[0][2], { expirationTtl: Math.round(declared * SECONDS_PER_DAY) });
    }
  });

  test('the register row and the code agree on whether a period exists', async () => {
    // The coupling that stops the two halves drifting: if the owner declares a
    // period in the code, the register row must stop calling it undeclared (and
    // assert-retention-coverage.mjs then verifies the TTL by reading the file).
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling/ops/register.json'), 'utf8'));
    const row = (reg.rows ?? []).find((r) => r.id === 'retention.kv.nikatru-signups.signup');
    assert.ok(row, 'retention.kv.nikatru-signups.signup is gone from the register — the seam has no recorded owner.');
    const declared = declaredPeriod();
    if (declared === null) {
      assert.equal(row.rule, 'period-undeclared', 'the code declares no period; the register must still say so.');
    } else {
      assert.notEqual(
        row.rule,
        'period-undeclared',
        `${SUBSCRIBE_REL} declares ${declared} day(s) but the register still calls the period undeclared. ` +
          'Move the row to `rule: "ttl"` so the guard verifies it against the code.',
      );
    }
  });
});
