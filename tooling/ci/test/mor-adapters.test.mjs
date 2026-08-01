// ─────────────────────────────────────────────────────────────────────────────
// mor-adapters.test.mjs — assert-mor-adapters.mjs must be able to FAIL.
//
// [pipeline 5]M-1 one verifier stands between a provider and the entitlement
// table · [5]M-14 the rail is green with no provider account WITHOUT certifying
// an empty rail · [ADR 004] provider-agnostic behind MoRWebhookVerifier ·
// [ADR 020]:18 no webhook in a per-app Worker.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-01, thirteen,
// on a scratch COPY of the repo; every restore re-verified green by the harness).
//
//   MOR1  `verifierFor(` — the seam's only caller — deleted   -> caught: "CALLED BY
//         from services/platform/src/routes/money.ts             NOTHING outside it"
//   MOR2  `persistNotification(`'s only caller deleted        -> caught: same shape
//   MOR3  `deriveAndApply(`'s only caller deleted             -> caught: same shape
//   MOR4  an `INSERT INTO entitlements` planted in the REAL   -> caught: "WRITES the
//         services/platform/src/routes/config.ts                 shared `entitlements`
//                                                                table and is NOT declared"
//   MOR5  the legacy RevenueCat route's `if (!configured)`    -> caught: "a fail-closed
//         fail-closed branch neutered                           branch … could not be found"
//   MOR6  the brick's erasure DELETE un-narrowed (the         -> caught: "a DELETE narrowed
//         `WHERE user_id = ?` removed)                           to `WHERE user_id = ?`"
//   MOR7  MOR_VERIFIERS emptied                               -> caught: "COVERAGE LOST …
//                                                                registers ZERO verifiers"
//   MOR8  the tampered-body test's `.replace(` removed, so    -> caught: "NO SINGLE test
//         the block expects 401 without altering the body       block both alters a signed
//                                                                body and expects 401"
//   MOR9  `app.route('/v1/money', money)` deleted             -> caught: "does not mount the
//                                                                money router"
//   MOR10 `interface MoRWebhookVerifier` renamed              -> caught: "no longer declares"
//   MOR11 the brick tree removed from REQUIRED_COVERAGE       -> caught: "COVERAGE LOST"
//   MOR12 the legacy writer's DECLARED_WRITERS entry deleted  -> caught: "is NOT declared"
//   MOR13 the whole [5]M-12 suite changed to `describe.skip`  -> caught after a FIX (see below)
//   MOR14 `app.route('/v1', entitlements)` deleted from the   -> caught: "does not mount the
//         REAL entrypoint                                        shared entitlement read"
//   MOR15 `app.use('/v1/entitlements', platformAuth)` deleted -> caught: "mounts
//                                                                /v1/entitlements WITHOUT
//                                                                platformAuth"
//   MOR16 the shared entitlement route re-pointed at a file   -> caught: "is ABSENT"
//         that does not exist
//   MOR17 the REAL legal register's Paddle row retired (id     -> caught: "registered rail
//         AND tells) while the rail stays registered             `paddle` has NO row"
//   MOR18 `money` un-claimed in the REAL legal register        -> caught BY THE OTHER GUARD
//         (assert-policy-claims.mjs, the K-5 limb)               ("neither a provider's tell")
//   None crashed; every one exited 1 with the intended message.
//
// ⚠️ MOR17'S FIRST ATTEMPT WAS INSUFFICIENT AND SAID SO. Renaming only the row's
// `id` left `"tells": ["paddle"]` behind, the rail still matched, and the guard
// correctly printed ok. The mutation had to retire the WHOLE row. That is the
// harness earning its keep: a mutation that does not remove the property is not
// evidence the guard is blind.
//
// ⚠️ MOR14–MOR16 EXIST BECAUSE [5]M-4 STOPPED BEING BLOCKED MID-INCREMENT. This
// guard originally PRINTED "M-4 is blocked on stage 4 [4]B-3" — correct when
// written, and a lie that prints on every run the moment `platformAuth` landed
// on the shared Worker. A printed gap whose blocker has cleared is worse than no
// gap at all: it reads as "somebody is on it" forever. It is a FAILING LIMB now.
//
// 🔴 TWO DEFECTS THE MUTATION RUN FOUND IN THE GUARD ITSELF, before any test
// existed — both of the "assertion that cannot fail" shape:
//   (a) The tampered-body check was FILE-LEVEL: "this file mentions tamper" AND
//       "this file mentions 401". Renaming the tampered-body test away left both
//       words elsewhere in a 500-line suite and the guard printed ok. It is now
//       scoped to ONE `it(...)` block that BOTH alters the signed body and
//       expects the rejection status.
//   (b) A SKIPPED test still counted. With the suite changed to `describe.skip`,
//       every assertion was readable and none of them ran. `.skip`/`.todo` are
//       now excluded, and a skipped `describe` disqualifies the whole file.
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
const GUARD = join(CI_DIR, 'assert-mor-adapters.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-mor-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** ⚠️ ASSEMBLED AT RUNTIME, never a literal — see the note in
 *  money-config.test.mjs. A credential-shaped string written out in a test
 *  fixture is a finding in the repository's own secret scan. */
const NTF_SECRET = `${'pdl'}${'_'}${'ntfset'}${'_'}x`;

const BRICK_ACCOUNT =
  'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/src/routes/account.ts';

const CONTRACT_TS = `
export interface MoRWebhookVerifier {
  readonly provider: string;
  readonly secretEnvVar: string;
  verify(raw: string, headers: Headers, secret: string, nowMs: number): Promise<unknown>;
  parse(raw: string): unknown;
}
`;

const PADDLE_TS = `
export const paddleVerifier: MoRWebhookVerifier = {
  provider: 'paddle',
  secretEnvVar: 'PADDLE_NOTIFICATION_SECRET',
  async verify(raw, headers, secret, nowMs) { return { ok: true }; },
  parse(raw) { return { ok: true }; },
};
`;

const REGISTRY_TS = `
import type { MoRWebhookVerifier } from './contract';
import { paddleVerifier } from './paddle';
export const MOR_VERIFIERS: readonly MoRWebhookVerifier[] = [paddleVerifier];
export function verifierFor(p: string) { return MOR_VERIFIERS.find((v) => v.provider === p) ?? null; }
`;

const STORE_TS = `
export async function persistNotification(deps, n, raw) {
  await deps.db.prepare('INSERT INTO entitlements (user_id) VALUES (?)').bind(1).run();
  return { fresh: true };
}
export async function deriveAndApply(deps, n) { return { outcome: 'applied' }; }
`;

const ROUTE_TS = `
import { verifierFor } from '../lib/mor/registry';
import { deriveAndApply, persistNotification } from '../lib/mor/store';
export default {
  async handle(c) {
    const v = verifierFor('paddle');
    await persistNotification({}, {}, '');
    await deriveAndApply({}, {});
    return v;
  },
};
`;

const INDEX_TS = `
import money from './routes/money';
import entitlements from './routes/entitlements';
import { platformAuth } from './middleware/auth';
const app = new Hono();
app.route('/v1/money', money);
app.use('/v1/entitlements', platformAuth);
app.route('/v1', entitlements);
export default { fetch: app.fetch };
`;

const ENTITLEMENTS_TS = `
const entitlements = new Hono();
entitlements.get('/entitlements', async (c) => c.json({ is_pro: false }));
export default entitlements;
`;

/** A test suite with ONE block that both tampers and expects 401. */
const MONEY_TEST_TS = `
import { describe, it, expect } from 'vitest';
const URL_UNDER_TEST = 'https://x/v1/money/paddle';
describe('the paddle rail', () => {
  it('A TAMPERED BODY IS REJECTED', async () => {
    const tampered = honest.replace('"status":"active"', '"status":"trialing"');
    expect((await send(URL_UNDER_TEST, tampered)).status).toBe(401);
  });
  it('happy path', async () => {
    expect((await send(URL_UNDER_TEST, honest)).status).toBe(200);
  });
});
`;

const LEGACY_WEBHOOK_TS = `
app.post('/revenuecat', async (c) => {
  const configured = c.env.REVENUECAT_WEBHOOK_SECRET;
  if (!configured) return c.json({ error: 'webhook_not_configured' }, 503);
  await c.env.PLATFORM_DB.prepare('INSERT INTO entitlements (user_id) VALUES (?)').bind(1).run();
  return c.json({ ok: true });
});
`;

const BRICK_ACCOUNT_TS = `
app.delete('/', async (c) => {
  await c.env.PLATFORM_DB.prepare('DELETE FROM entitlements WHERE user_id = ?').bind(userId).run();
  return c.json({ ok: true });
});
`;

function write(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

/** Build a fixture repo mirroring the real one's SHAPE and run the guard. */
function run(o = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  write(root, 'services/platform/src/lib/mor/contract.ts', o.contract ?? CONTRACT_TS);
  write(root, 'services/platform/src/lib/mor/paddle.ts', o.paddle ?? PADDLE_TS);
  write(root, 'services/platform/src/lib/mor/registry.ts', o.registry ?? REGISTRY_TS);
  write(root, 'services/platform/src/lib/mor/store.ts', o.store ?? STORE_TS);
  write(root, 'services/platform/src/routes/money.ts', o.route ?? ROUTE_TS);
  write(root, 'services/platform/src/index.ts', o.index ?? INDEX_TS);
  if (o.entitlementsRoute !== null) {
    write(root, 'services/platform/src/routes/entitlements.ts', o.entitlementsRoute ?? ENTITLEMENTS_TS);
  }
  write(root, 'services/platform/test/money.test.ts', o.moneyTest ?? MONEY_TEST_TS);
  write(root, 'services/platform/wrangler.jsonc', o.wrangler ?? '{ "name": "platform", "vars": { "MONEY_ENVIRONMENT": "live" } }');
  write(root, 'services/subly-api/src/routes/webhooks.ts', o.legacy ?? LEGACY_WEBHOOK_TS);
  write(root, BRICK_ACCOUNT, o.brickAccount ?? BRICK_ACCOUNT_TS);
  if (o.legalRegister !== null) {
    write(
      root,
      'tooling/legal/provider-register.json',
      o.legalRegister ??
        JSON.stringify({
          providers: [{ id: 'paddle', name: 'Paddle', role: 'merchant_of_record', tells: ['paddle'] }],
        }),
    );
  }
  if (o.extra) for (const [rel, body] of Object.entries(o.extra)) write(root, rel, body);
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, root };
}

describe('assert-mor-adapters — one verifier between a provider and the entitlement table', () => {
  test('PASSES on a complete rail, and PRINTS the owner-gated gap', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}MoR adapters/);
    // [5]M-14's whole point: the gap is reported on EVERY run, pass or fail, so
    // "finished, waiting on one signup" can never look like "nothing built".
    assert.match(r.out, /OWNER-GATED HALF/);
    assert.match(r.out, /A-1/);
  });

  test('FAILS when the shared entitlement read is ABSENT — [5]M-4', () => {
    // This was a PRINTED "blocked on stage 4" gap until [4]B-3 landed
    // `platformAuth` on the shared Worker. The moment the blocker cleared, a
    // printed gap became a lie that prints on every run, so it is a failing limb.
    const r = run({ entitlementsRoute: null });
    assert.equal(r.code, 1);
    assert.match(r.out, /routes\/entitlements\.ts is ABSENT/);
  });

  test('FAILS when the shared entitlement read is not mounted', () => {
    const r = run({ index: INDEX_TS.replace("app.route('/v1', entitlements);", '') });
    assert.equal(r.code, 1);
    assert.match(r.out, /does not mount the shared entitlement read/);
  });

  test('FAILS when the shared entitlement read is mounted WITHOUT platformAuth', () => {
    // An unauthenticated read of a per-user table has no subject to scope by, so
    // it would answer for everybody or for nobody.
    const r = run({ index: INDEX_TS.replace("app.use('/v1/entitlements', platformAuth);", '') });
    assert.equal(r.code, 1);
    assert.match(r.out, /mounts \/v1\/entitlements WITHOUT platformAuth/);
  });

  test('FAILS on an UNDECLARED entitlements writer anywhere in services/**', () => {
    const r = run({ extra: { 'services/platform/src/routes/config.ts': "const q = 'INSERT INTO entitlements (user_id) VALUES (?)';\n" } });
    assert.equal(r.code, 1);
    assert.match(r.out, /services\/platform\/src\/routes\/config\.ts WRITES the shared `entitlements` table and is NOT declared/);
  });

  test('FAILS on an undeclared writer in the LEGACY app Worker — the scan is not scoped to the new thing', () => {
    // The single most expensive recurring shape in this repo: a guard scoped to
    // services/platform reports clean standing next to a deployed writer in
    // services/subly-api.
    const r = run({ extra: { 'services/subly-api/src/routes/sneaky.ts': "await db.prepare('UPDATE entitlements SET is_active = 1').run();\n" } });
    assert.equal(r.code, 1);
    assert.match(r.out, /services\/subly-api\/src\/routes\/sneaky\.ts WRITES/);
  });

  test('FAILS on an entitlements writer inside the BRICK template — [ADR 020]:18 scales to 50 apps', () => {
    const r = run({
      extra: {
        'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/src/routes/webhook.ts':
          "await c.env.PLATFORM_DB.prepare('INSERT INTO entitlements (user_id) VALUES (?)').run();\n",
      },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /brick.*webhook\.ts WRITES/s);
  });

  test('an entitlements write named ONLY IN A COMMENT does not count as a writer', () => {
    const r = run({
      extra: {
        'services/platform/src/routes/notes.ts':
          '// This module does NOT run INSERT INTO entitlements — that is store.ts\'s job.\n/* UPDATE entitlements SET is_active = 1 */\nexport const x = 1;\n',
      },
    });
    assert.equal(r.code, 0, r.out);
  });

  test('a `//` inside a string literal does not blank the rest of the line', () => {
    // 🔴 A REAL GUARD BUG, found while writing this file. The comment stripper
    // treated the `//` in `'https://…'` as a line comment and blanked
    // everything after it — which silently removed the provider name from the
    // test corpus, and would just as silently hide an entitlements write placed
    // after a URL on the same line.
    const r = run({
      extra: {
        'services/platform/src/routes/sneaky.ts':
          "const u = 'https://x/y'; const q = 'INSERT INTO entitlements (user_id) VALUES (?)';\n",
      },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /sneaky\.ts WRITES the shared `entitlements` table/);
  });

  test('a test file that writes entitlements is NOT a production writer', () => {
    const r = run({ extra: { 'services/platform/test/fixture.test.ts': "db.exec('INSERT INTO entitlements (user_id) VALUES (1)');\n" } });
    assert.equal(r.code, 0, r.out);
  });

  test('FAILS when the legacy shared-secret writer loses its fail-closed branch', () => {
    const r = run({ legacy: LEGACY_WEBHOOK_TS.replace('if (!configured)', 'if (false)') });
    assert.equal(r.code, 1);
    assert.match(r.out, /a fail-closed branch on an unset webhook secret could not be found/);
  });

  test("FAILS when the brick's erasure DELETE stops being narrowed to the caller", () => {
    const r = run({ brickAccount: BRICK_ACCOUNT_TS.replace("DELETE FROM entitlements WHERE user_id = ?", 'DELETE FROM entitlements') });
    assert.equal(r.code, 1);
    assert.match(r.out, /a DELETE narrowed to `WHERE user_id = \?` could not be found/);
  });

  test('FAILS when the verifier registry is called by NOTHING outside the file that declares it', () => {
    const r = run({ route: ROUTE_TS.replace('const v = verifierFor(\'paddle\');', 'const v = null;') });
    assert.equal(r.code, 1);
    assert.match(r.out, /`verifierFor` is declared in .* and CALLED BY NOTHING outside it/);
  });

  test('FAILS when the verbatim store is present but uncalled', () => {
    const r = run({ route: ROUTE_TS.replace('await persistNotification({}, {}, \'\');', '') });
    assert.equal(r.code, 1);
    assert.match(r.out, /`persistNotification` is declared in .* and CALLED BY NOTHING outside it/);
  });

  test('FAILS when the derivation is present but uncalled', () => {
    const r = run({ route: ROUTE_TS.replace('await deriveAndApply({}, {});', '') });
    assert.equal(r.code, 1);
    assert.match(r.out, /`deriveAndApply` is declared in .* and CALLED BY NOTHING outside it/);
  });

  test('a caller inside the DECLARING file does not count', () => {
    // assert-seams-wired.mjs carries the scar: a check that matched its own
    // function's declaration kept passing after every real caller was deleted.
    const r = run({
      route: ROUTE_TS.replace('const v = verifierFor(\'paddle\');', 'const v = null;'),
      registry: `${REGISTRY_TS}\nconst self = verifierFor('paddle');\n`,
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /`verifierFor` is declared in .* and CALLED BY NOTHING outside it/);
  });

  test('a caller in a TEST does not count — a seam whose only caller is a test is dead', () => {
    const r = run({
      route: ROUTE_TS.replace('const v = verifierFor(\'paddle\');', 'const v = null;'),
      extra: { 'services/platform/test/registry.test.ts': "verifierFor('paddle');\n" },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /`verifierFor` is declared in .* and CALLED BY NOTHING outside it/);
  });

  test('FAILS when the money router is not mounted — a rail no provider can reach', () => {
    const r = run({ index: INDEX_TS.replace("app.route('/v1/money', money);", '') });
    assert.equal(r.code, 1);
    assert.match(r.out, /does not mount the money router at \/v1\/money/);
  });

  test("FAILS when the MoRWebhookVerifier interface is gone — [ADR 004]'s locked shape", () => {
    const r = run({ contract: CONTRACT_TS.replace('interface MoRWebhookVerifier', 'interface SomethingElse') });
    assert.equal(r.code, 1);
    assert.match(r.out, /no longer declares `interface MoRWebhookVerifier`/);
  });

  test('FAILS when a registered provider has no adapter file', () => {
    const r = run({
      registry: REGISTRY_TS.replace('[paddleVerifier]', '[paddleVerifier, lemonsqueezyVerifier]'),
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /registered provider `lemonsqueezy` has no adapter/);
  });

  test('FAILS when an adapter does not implement verify or parse', () => {
    const r = run({ paddle: PADDLE_TS.replace('parse(raw) { return { ok: true }; },', '') });
    assert.equal(r.code, 1);
    assert.match(r.out, /does not implement `parse`/);
  });

  test('FAILS when NO SINGLE test block both tampers with the body and expects 401', () => {
    // 🔴 THE GUARD BUG THIS TEST RECORDS. The check used to be file-level, so
    // both words surviving anywhere in a long suite satisfied it.
    const r = run({
      moneyTest: MONEY_TEST_TS.replace(
        "    const tampered = honest.replace('\"status\":\"active\"', '\"status\":\"trialing\"');",
        '    const tampered = honest;',
      ),
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO SINGLE test block both alters a signed body and expects 401/);
  });

  test('a SKIPPED suite is text, not evidence', () => {
    const r = run({ moneyTest: MONEY_TEST_TS.replace("describe('the paddle rail'", "describe.skip('the paddle rail'") });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO SINGLE test block both alters a signed body and expects 401/);
  });

  test('a SKIPPED it() is text, not evidence', () => {
    const r = run({ moneyTest: MONEY_TEST_TS.replace("it('A TAMPERED BODY IS REJECTED'", "it.skip('A TAMPERED BODY IS REJECTED'") });
    assert.equal(r.code, 1);
    assert.match(r.out, /NO SINGLE test block both alters a signed body and expects 401/);
  });

  test('FAILS when a registered rail has NO row in the legal provider register', () => {
    // 🔴 THE LIMB THAT REPLACES A K-5 CHECK THIS ROUTE SHAPE DEFEATS.
    // assert-policy-claims.mjs turns the build red when a payment webhook lands
    // as a LITERAL route segment (`/paddle`, `/stripe`). This rail is mounted at
    // `/v1/money/:provider` and that check drops `:param` segments by design, so
    // a second rail would add no segment and K-5 could not see it. The provider
    // set is data HERE, so the obligation moved here rather than being noted in
    // a comment.
    const r = run({
      registry: REGISTRY_TS.replace('[paddleVerifier]', '[paddleVerifier, lemonsqueezyVerifier]'),
      extra: {
        'services/platform/src/lib/mor/lemonsqueezy.ts':
          "export const lemonsqueezyVerifier = { provider: 'lemonsqueezy', secretEnvVar: 'LS_SECRET', async verify() {}, parse() {} };\n",
      },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /registered rail `lemonsqueezy` has NO row in tooling\/legal\/provider-register\.json/);
    assert.match(r.out, /LEGAL SELLER/);
  });

  test('a rail matched by a `tells` entry rather than by `id` still counts', () => {
    const r = run({
      legalRegister: JSON.stringify({
        providers: [{ id: 'paddle-billing', name: 'Paddle', tells: ['paddle', 'paddle billing'] }],
      }),
    });
    assert.equal(r.code, 0, r.out);
  });

  test('COVERAGE LOST when the legal provider register is gone', () => {
    const r = run({ legalRegister: null });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — tooling\/legal\/provider-register\.json does not exist/);
  });

  test('COVERAGE LOST when the legal register declares zero providers', () => {
    const r = run({ legalRegister: JSON.stringify({ providers: [] }) });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — .* declares zero providers/);
  });

  test('COVERAGE LOST when the provider registry is empty', () => {
    const r = run({ registry: REGISTRY_TS.replace('[paddleVerifier]', '[]') });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — .* registers ZERO verifiers/);
  });

  test('COVERAGE LOST when a required tree is missing from the scan', () => {
    const root = join(TMP, `case-${(seq += 1)}`);
    write(root, 'services/platform/src/index.ts', INDEX_TS);
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST/);
  });

  test('FAILS when a DECLARED_WRITERS entry has gone stale', () => {
    // A stale entry inflates apparent coverage and its gate claim can never fail.
    const r = run({ legacy: 'export const nothing = 1;\n' });
    assert.equal(r.code, 1);
    assert.match(r.out, /DECLARED_WRITERS names `services\/subly-api\/src\/routes\/webhooks\.ts`, which no longer writes/);
  });

  test('the PADDLE destination secret must never be a committed var', () => {
    const r = run({ wrangler: `{ "name": "platform", "vars": { "PADDLE_NOTIFICATION_SECRET": "${NTF_SECRET}" } }` });
    assert.equal(r.code, 1);
    assert.match(r.out, /declares PADDLE_NOTIFICATION_SECRET as a committed var/);
  });
});
