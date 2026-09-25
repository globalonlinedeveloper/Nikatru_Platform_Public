// ─────────────────────────────────────────────────────────────────────────────
// wrangler-environments.test.mjs — wrangler-environments.mjs must return ONE
// finding per way an environment can reach production, and NONE for a sandbox
// that stays off it.
//
// Added 2026-09-25 (capsand-b, parent ruling CAPSAND-5 item 1), when the
// predicate moved out of assert-money-config.mjs limb 1c so that
// assert-release-provenance.mjs limb 2b could excuse a sandbox deploy on the
// same proof. Each red below mutates ONE field of a green config; the green
// controls are a hand-built sandbox and the two REAL sandbox environments,
// without which every red would be consistent with a predicate that always
// complains.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isObject, routeHosts, d1Of, sandboxEnvironmentFindings } from '../wrangler-environments.mjs';
import { parseJsonc } from '../d1-sql-inventory.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const TOP = {
  routes: [{ pattern: 'api.example.com', custom_domain: true }],
  triggers: { crons: ['0 3 * * *'] },
  d1_databases: [{ binding: 'PLATFORM_DB', database_id: 'prod-db' }],
};
function sandbox() {
  return {
    routes: [],
    workers_dev: true,
    triggers: { crons: [] },
    d1_databases: [{ binding: 'PLATFORM_DB', database_id: 'sandbox-db' }],
  };
}

describe('wrangler-environments — the helpers', () => {
  test('isObject refuses null and arrays', () => {
    assert.equal(isObject({}), true);
    assert.equal(isObject(null), false);
    assert.equal(isObject([]), false);
  });

  test('routeHosts reads `route`, a string route and a pattern object, lower-cased and path-stripped', () => {
    assert.deepEqual(routeHosts({ route: 'A.example.com/*', routes: ['b.example.com/x', { pattern: 'C.example.com', custom_domain: true }] }), [
      'a.example.com',
      'b.example.com',
      'c.example.com',
    ]);
  });

  test('d1Of drops a non-object binding', () => {
    assert.deepEqual(d1Of({ d1_databases: [{ binding: 'X' }, 'junk', null] }), [{ binding: 'X' }]);
  });
});

describe('wrangler-environments — sandboxEnvironmentFindings', () => {
  test('GREEN: a sandbox with its own empty routes, no crons, workers_dev and its own database has no finding', () => {
    assert.deepEqual(sandboxEnvironmentFindings('w env.sandbox', TOP, sandbox()), []);
  });

  test('GREEN on the REAL tree: both sandbox environments the store captures write to have no finding', () => {
    for (const rel of ['services/platform/wrangler.jsonc', 'services/subscriptiontracker-api/wrangler.jsonc']) {
      const cfg = parseJsonc(readFileSync(join(REPO, rel), 'utf8'));
      assert.ok(isObject(cfg.env?.sandbox), `${rel} declares env.sandbox`);
      assert.deepEqual(sandboxEnvironmentFindings(`${rel} env.sandbox`, cfg, cfg.env.sandbox), [], rel);
    }
  });

  test('RED: no `routes` inherits the production host', () => {
    const e = sandbox();
    delete e.routes;
    const out = sandboxEnvironmentFindings('w env.sandbox', TOP, e);
    assert.equal(out.length, 1);
    assert.match(out[0], /^w env\.sandbox declares no `routes`, so it INHERITS the top level's \(api\.example\.com\)/);
  });

  test('RED: a route on a production host', () => {
    const e = sandbox();
    e.routes = [{ pattern: 'API.example.com', custom_domain: true }];
    const out = sandboxEnvironmentFindings('w env.sandbox', TOP, e);
    assert.equal(out.length, 1);
    assert.match(out[0], /binds `api\.example\.com`, a hostname the top level \(the production deploy\) already binds/);
  });

  test('RED: `triggers` omitted inherits the production crons', () => {
    const e = sandbox();
    delete e.triggers;
    const out = sandboxEnvironmentFindings('w env.sandbox', TOP, e);
    assert.equal(out.length, 1);
    assert.match(out[0], /declares no `triggers\.crons`, so it INHERITS the top level's/);
  });

  test('RED: a cron of its own', () => {
    const e = sandbox();
    e.triggers.crons = ['*/5 * * * *'];
    const out = sandboxEnvironmentFindings('w env.sandbox', TOP, e);
    assert.equal(out.length, 1);
    assert.match(out[0], /runs 1 cron\(s\)/);
  });

  test('RED: `workers_dev` omitted', () => {
    const e = sandbox();
    delete e.workers_dev;
    const out = sandboxEnvironmentFindings('w env.sandbox', TOP, e);
    assert.equal(out.length, 1);
    assert.match(out[0], /declares no `workers_dev`, so it INHERITS the top level's/);
  });

  test('RED: `workers_dev: false`', () => {
    const e = sandbox();
    e.workers_dev = false;
    const out = sandboxEnvironmentFindings('w env.sandbox', TOP, e);
    assert.equal(out.length, 1);
    assert.match(out[0], /sets workers_dev = false/);
  });

  test('RED: no PLATFORM_DB where the top level binds one', () => {
    const e = sandbox();
    e.d1_databases = [];
    const out = sandboxEnvironmentFindings('w env.sandbox', TOP, e);
    assert.equal(out.length, 1);
    assert.match(out[0], /binds no PLATFORM_DB\. Wrangler does not inherit `d1_databases`/);
  });

  test('RED: PLATFORM_DB with no database_id', () => {
    const e = sandbox();
    e.d1_databases = [{ binding: 'PLATFORM_DB' }];
    const out = sandboxEnvironmentFindings('w env.sandbox', TOP, e);
    assert.equal(out.length, 1);
    assert.match(out[0], /binds PLATFORM_DB with no `database_id`/);
  });

  test('RED: any binding to a database the top level binds', () => {
    const e = sandbox();
    e.d1_databases.push({ binding: 'OTHER_DB', database_id: 'prod-db' });
    const out = sandboxEnvironmentFindings('w env.sandbox', TOP, e);
    assert.equal(out.length, 1);
    assert.match(out[0], /binds OTHER_DB to a PRODUCTION database \(prod-db, bound at the top level\)/);
  });

  test('a top level with no PLATFORM_DB does not require one of the sandbox', () => {
    const top = { ...TOP, d1_databases: [{ binding: 'APP_DB', database_id: 'prod-app' }] };
    const e = sandbox();
    e.d1_databases = [{ binding: 'APP_DB', database_id: 'sandbox-app' }];
    assert.deepEqual(sandboxEnvironmentFindings('w env.sandbox', top, e), []);
  });
});
