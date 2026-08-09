// ─────────────────────────────────────────────────────────────────────────────
// money-config.test.mjs — assert-money-config.mjs must be able to FAIL.
//
// [pipeline 5]M-12 — sandbox money can never grant a production unlock.
//
// 🔴 WHY THIS GUARD EXISTS AT THE CONFIG LAYER AT ALL. The original acceptance
// criterion asked for an input NOBODY CAN CONSTRUCT: "a correctly-signed sandbox
// notification does not grant a production entitlement" is unfalsifiable,
// because sandbox and live credentials are disjoint, so such a notification is
// rejected by the SIGNATURE check ([5]M-1) before this requirement is reached.
// It asserted nothing M-1 did not. Every case below, by contrast, is a value
// somebody can type into a file — which is the whole point of the replacement.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-01, twelve, on
// a scratch COPY of the repo; every restore re-verified green by the harness).
//
//   MC1  the deployed wrangler config flipped to           -> caught: "declares
//        MONEY_ENVIRONMENT: sandbox                           MONEY_ENVIRONMENT = \"sandbox\""
//   MC2  MONEY_ENVIRONMENT removed entirely                -> caught: "NO deployed config
//                                                             declares MONEY_ENVIRONMENT"
//   MC3  `sandbox-api.paddle.com` planted in the config    -> caught: "the Paddle SANDBOX
//                                                             API base URL"
//   MC4  a `pdl_sdbx_apikey_` value planted                -> caught: "a Paddle SANDBOX
//                                                             API key prefix"
//   MC5  PADDLE_NOTIFICATION_SECRET committed as a var     -> caught: "as a committed
//        in a PUBLIC repository                              `vars` entry"
//   MC6  a SECOND Worker declares a money environment      -> caught (2026-08-09 form: the
//        WITHOUT carrying a money door                        declaring set must EQUAL the
//                                                             derived money-door set; [ADR
//                                                             039] D5 made a two-door tree
//                                                             the decided state, so "exactly
//                                                             one" stopped being the rule)
//   MC7  the resolver's `: null` refusal replaced by       -> caught after a FIX (below)
//        `: ('live' as MoneyEnvironment)`
//   MC8  `isMoneyEnvironment(...)` removed                 -> caught: "does not validate"
//   MC9  MOR_VERIFIERS emptied                             -> caught: "COVERAGE LOST —
//                                                             derived ZERO money secrets"
//   MC10 the adapter's `secretEnvVar` removed              -> caught: "declares no
//                                                             `secretEnvVar`"
//   MC11 the resolver made total (never returns null)      -> caught: "never returns null"
//   MC12 the whole [5]M-12 suite changed to describe.skip  -> caught after a FIX (below)
//
// 🔴 TWO DEFECTS THE MUTATION RUN FOUND IN THE GUARD ITSELF:
//   (a) MC7 WAS NOT CAUGHT. Limb 4 looked for the literal pattern
//       `MONEY_ENVIRONMENT ?? 'live'`. Replacing the resolver's refusal branch
//       with `('live' as MoneyEnvironment)` left `isMoneyEnvironment(` present,
//       left the now-unreachable 503 refusal present, matched no `??`, and the
//       guard printed ok over a rail that treats every misconfigured deploy as
//       LIVE. The resolver's BODY is now read as a unit.
//   (b) MC12 WAS NOT CAUGHT. A `describe.skip` left every assertion readable and
//       none of them running. `.skip`/`.todo` no longer count as evidence.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-money-config.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-mcfg-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** ⚠️ EVERY CREDENTIAL-SHAPED FIXTURE VALUE IS ASSEMBLED AT RUNTIME, never
 *  written as a literal — the same idiom tooling/ci/scan-secrets.mjs uses for
 *  its own canaries, and for the same reason: written literally, this file
 *  becomes a finding in the scan it exists to test. CI caught exactly that on
 *  the first push (gitleaks' default `generic-api-key` rule, not one of ours).
 *  Allowlisting was the tempting fix and the wrong one: every allowlist entry
 *  is a permanent hole in the net. */
const U = '_';
const SANDBOX_KEY = `${'pdl'}${U}${'sdbx'}${U}${'apikey'}${U}0123`;
const NTF_SECRET = `${'pdl'}${U}${'ntfset'}${U}x`;

const PLATFORM_WRANGLER = `{
  // A COMMENT that names a sandbox host on purpose: sandbox-api.paddle.com and
  // a pdl_sdbx_apikey_ prefix. A guard that grepped raw text would fail on the
  // very paragraph explaining what must never appear.
  "name": "platform",
  "vars": {
    "APP_ID": "platform",
    "MONEY_ENVIRONMENT": "live"
  }
}`;

const SUBLY_WRANGLER = '{ "name": "subly-api", "vars": { "APP_ID": "subly" } }';

const REGISTRY_TS = `
import { paddleVerifier } from './paddle';
export const MOR_VERIFIERS: readonly MoRWebhookVerifier[] = [paddleVerifier];
`;

const PADDLE_TS = `
export const paddleVerifier: MoRWebhookVerifier = {
  provider: 'paddle',
  secretEnvVar: 'PADDLE_NOTIFICATION_SECRET',
};
`;

const ROUTE_TS = `
import { isMoneyEnvironment, type MoneyEnvironment } from '../lib/mor/contract';
function environmentOf(raw: string | undefined): MoneyEnvironment | null {
  return isMoneyEnvironment(raw) ? raw : null;
}
money.post('/:provider', async (c) => {
  const environment = environmentOf(c.env.MONEY_ENVIRONMENT);
  if (environment === null) return c.json({ error: 'money_rail_not_configured' }, 503);
  return c.json({ ok: true });
});
`;

const MONEY_TEST_TS = `
import { describe, it, expect } from 'vitest';
describe('[5]M-12', () => {
  it('an absent money environment FAILS CLOSED with 503', async () => {
    const res = await send({ environment: undefined });
    expect(res.status).toBe(503);
  });
});
`;

function write(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

/** A second money DOOR, in subly-api's shape: the fail-closed refusal without
 *  the MoR resolver — limb 1/5 derive from the marker, limb 4 stays platform's. */
const SUBLY_DOOR_TS = `
import { isMoneyEnvironment } from '../lib/money';
app.post('/revenuecat', async (c) => {
  if (!isMoneyEnvironment(c.env.MONEY_ENVIRONMENT)) {
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }
  return c.json({ ok: true });
});
`;

const SUBLY_MONEY_TEST_TS = `
import { describe, it, expect } from 'vitest';
describe('[5]M-12 — the RevenueCat door', () => {
  it('503s when the money environment is unset', async () => {
    const res = await post({ environment: undefined });
    expect(res.status).toBe(503);
  });
});
`;

function run(o = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  write(root, 'services/platform/wrangler.jsonc', o.platformWrangler ?? PLATFORM_WRANGLER);
  if (o.sublyWrangler !== null) write(root, 'services/subly-api/wrangler.jsonc', o.sublyWrangler ?? SUBLY_WRANGLER);
  write(root, 'services/platform/src/lib/mor/registry.ts', o.registry ?? REGISTRY_TS);
  write(root, 'services/platform/src/lib/mor/paddle.ts', o.paddle ?? PADDLE_TS);
  if (o.route !== null) write(root, 'services/platform/src/routes/money.ts', o.route ?? ROUTE_TS);
  write(root, 'services/platform/test/money.test.ts', o.moneyTest ?? MONEY_TEST_TS);
  if (o.sublySrc) write(root, 'services/subly-api/src/routes/webhooks.ts', o.sublySrc);
  if (o.sublyTest) write(root, 'services/subly-api/test/webhooks.test.ts', o.sublyTest);
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('assert-money-config — sandbox money cannot grant a production unlock', () => {
  test('PASSES on a correctly configured live rail', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}money config/);
  });

  test('a sandbox host named ONLY IN A COMMENT does not fail the build', () => {
    // The fixture's own comment block names sandbox-api.paddle.com and
    // pdl_sdbx_apikey_. This repo has shipped a guard whose grep matched the
    // comment explaining why the thing it looked for was absent.
    const r = run();
    assert.equal(r.code, 0, r.out);
  });

  test('FAILS when the DEPLOYED config declares the sandbox money world', () => {
    const r = run({ platformWrangler: PLATFORM_WRANGLER.replace('"live"', '"sandbox"') });
    assert.equal(r.code, 1);
    assert.match(r.out, /declares MONEY_ENVIRONMENT = "sandbox"/);
  });

  test('FAILS when no deployed config declares a money environment at all', () => {
    const r = run({ platformWrangler: '{ "name": "platform", "vars": { "APP_ID": "platform" } }' });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO deployed config declares MONEY_ENVIRONMENT/);
  });

  test('FAILS when a Worker declares the money environment WITHOUT carrying a door', () => {
    const r = run({ sublyWrangler: '{ "name": "subly-api", "vars": { "MONEY_ENVIRONMENT": "live" } }' });
    assert.equal(r.code, 1);
    assert.match(r.out, /declares MONEY_ENVIRONMENT but no file under services\/subly-api\/src refuses/);
  });

  test('FAILS when a Worker carries a money door WITHOUT declaring its environment', () => {
    const r = run({ sublySrc: SUBLY_DOOR_TS, sublyTest: SUBLY_MONEY_TEST_TS });
    assert.equal(r.code, 1);
    assert.match(r.out, /services\/subly-api carries a money door .* declares no MONEY_ENVIRONMENT/);
  });

  test('PASSES on the decided two-door tree — MoR rail plus the RevenueCat fan-in', () => {
    // The real tree since [ADR 039] D5's hardening chip: both Workers carry the
    // fail-closed door, both declare "live", both exercise their own 503.
    const r = run({
      sublyWrangler: '{ "name": "subly-api", "vars": { "MONEY_ENVIRONMENT": "live" } }',
      sublySrc: SUBLY_DOOR_TS,
      sublyTest: SUBLY_MONEY_TEST_TS,
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\{platform, subly-api\}/);
  });

  test('FAILS when the second door declares the sandbox world', () => {
    const r = run({
      sublyWrangler: '{ "name": "subly-api", "vars": { "MONEY_ENVIRONMENT": "sandbox" } }',
      sublySrc: SUBLY_DOOR_TS,
      sublyTest: SUBLY_MONEY_TEST_TS,
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /declares MONEY_ENVIRONMENT = "sandbox"/);
  });

  test("FAILS when the second door's own tests never fire its 503 — platform's suite does not vouch for it", () => {
    const r = run({
      sublyWrangler: '{ "name": "subly-api", "vars": { "MONEY_ENVIRONMENT": "live" } }',
      sublySrc: SUBLY_DOOR_TS,
      // no sublyTest: services/subly-api/test does not exist in this fixture
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — no test files under services\/subly-api\/test/);
  });

  test('a door whose 503 evidence is only a SKIPPED subly test still fails', () => {
    const r = run({
      sublyWrangler: '{ "name": "subly-api", "vars": { "MONEY_ENVIRONMENT": "live" } }',
      sublySrc: SUBLY_DOOR_TS,
      sublyTest: SUBLY_MONEY_TEST_TS.replace("it('503s", "it.skip('503s"),
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /yields 503 under services\/subly-api\/test/);
  });

  test('FAILS on a Paddle SANDBOX base URL in a deployed config', () => {
    const r = run({ platformWrangler: PLATFORM_WRANGLER.replace('"APP_ID": "platform",', '"PADDLE_API": "https://sandbox-api.paddle.com",') });
    assert.equal(r.code, 1);
    assert.match(r.out, /the Paddle SANDBOX API base URL/);
  });

  test('FAILS on a Paddle SANDBOX API key prefix in a deployed config', () => {
    const r = run({ platformWrangler: PLATFORM_WRANGLER.replace('"APP_ID": "platform",', `"PADDLE_KEY": "${SANDBOX_KEY}",`) });
    assert.equal(r.code, 1);
    assert.match(r.out, /a Paddle SANDBOX API key prefix/);
  });

  test('FAILS when the destination SECRET is committed as a var', () => {
    const r = run({ platformWrangler: PLATFORM_WRANGLER.replace('"APP_ID": "platform",', `"PADDLE_NOTIFICATION_SECRET": "${NTF_SECRET}",`) });
    assert.equal(r.code, 1);
    assert.match(r.out, /declares PADDLE_NOTIFICATION_SECRET as a committed `vars` entry/);
  });

  test('FAILS when the route stops validating the environment', () => {
    const r = run({ route: ROUTE_TS.replace('isMoneyEnvironment(raw) ? raw : null', 'raw as MoneyEnvironment') });
    assert.equal(r.code, 1);
    assert.match(r.out, /does not validate the environment with `isMoneyEnvironment/);
  });

  test('FAILS when the resolver can never answer "I cannot tell"', () => {
    const r = run({ route: ROUTE_TS.replace('isMoneyEnvironment(raw) ? raw : null', 'isMoneyEnvironment(raw) ? raw : (raw as MoneyEnvironment)') });
    assert.equal(r.code, 1);
    assert.match(r.out, /never returns null/);
  });

  test('FAILS when the resolver names a money world itself — the mutation the first version missed', () => {
    const r = run({ route: ROUTE_TS.replace("isMoneyEnvironment(raw) ? raw : null", "isMoneyEnvironment(raw) ? raw : ('live' as MoneyEnvironment)") });
    assert.equal(r.code, 1);
    assert.match(r.out, /names a money world itself \('live'\)/);
  });

  test('FAILS when the 503 refusal is gone', () => {
    const r = run({ route: ROUTE_TS.replace("{ error: 'money_rail_not_configured' }, 503", '{ ok: true }, 200') });
    assert.equal(r.code, 1);
    assert.match(r.out, /has no `money_rail_not_configured` refusal/);
  });

  test('FAILS when nothing EXERCISES the fail-closed branch', () => {
    const r = run({ moneyTest: "import { it, expect } from 'vitest';\nit('happy path', async () => { expect(1).toBe(1); });\n" });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO SINGLE test block asserts that an absent or unrecognised money environment yields 503/);
  });

  test('a SKIPPED suite does not exercise anything', () => {
    const r = run({ moneyTest: MONEY_TEST_TS.replace("describe('[5]M-12'", "describe.skip('[5]M-12'") });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO SINGLE test block asserts/);
  });

  test('a SKIPPED it() does not exercise anything', () => {
    const r = run({ moneyTest: MONEY_TEST_TS.replace("it('an absent", "it.skip('an absent") });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO SINGLE test block asserts/);
  });

  test('COVERAGE LOST when the adapter registry is empty — "exactly one secret" over zero rails', () => {
    const r = run({ registry: REGISTRY_TS.replace('[paddleVerifier]', '[]') });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — derived ZERO money destination secrets/);
  });

  test('FAILS when an adapter stops naming its destination secret', () => {
    const r = run({ paddle: PADDLE_TS.replace("secretEnvVar: 'PADDLE_NOTIFICATION_SECRET',", '') });
    assert.equal(r.code, 1);
    assert.match(r.out, /declares no `secretEnvVar`/);
  });

  test('COVERAGE LOST when the money Worker has no deployed config', () => {
    const root = join(TMP, `case-${(seq += 1)}`);
    write(root, 'services/subly-api/wrangler.jsonc', SUBLY_WRANGLER);
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST — no deployed config for services\/platform/);
  });

  test('COVERAGE LOST when the route file is gone', () => {
    const r = run({ route: null });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — services\/platform\/src\/routes\/money\.ts does not exist/);
  });
});
