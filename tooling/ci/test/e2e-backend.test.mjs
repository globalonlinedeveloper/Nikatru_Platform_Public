// ─────────────────────────────────────────────────────────────────────────────
// e2e-backend.test.mjs — the one resolver from an app id to its Worker's
// databases (tooling/e2e/backend.mjs). Row O-E2E-LANE-WIRED-TO-ONE-APP.
//
// Every fixture id is a synthetic UUID made up for this file; no production
// database id is written here. The fixture tree is handed to the module through
// `read` and `appIds`, so a case names exactly the one key it breaks. The last
// two groups read the REAL tree, comparing values at run time only. Each case
// is written out by hand.
//
// Run:  node --test tooling/ci/test/e2e-backend.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { backendOf, appIdsWithWorker, e2eAppOf, BackendRefused } from '../../e2e/backend.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODULE = join(REPO, 'tooling', 'e2e', 'backend.mjs');

// Synthetic ids: the 1111…/2222… family is app one's, 3333…/4444… app two's.
const ALPHA_APP_DB = '11111111-1111-4111-8111-111111111111';
const ALPHA_SBX_APP_DB = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const BETA_APP_DB = '33333333-3333-4333-8333-333333333333';
const PLATFORM_DB = '22222222-2222-4222-8222-222222222222';
const SBX_PLATFORM_DB = '22222222-2222-4222-8222-bbbbbbbbbbbb';

/** Two app Workers shaped like the real one: APP_DB + PLATFORM_DB at the top
 *  level and in `env.sandbox`. A fresh copy per call. */
const fixture = () => ({
  'services/alpha-api/wrangler.jsonc': {
    name: 'alpha-api',
    d1_databases: [
      { binding: 'APP_DB', database_name: 'alpha_db', database_id: ALPHA_APP_DB },
      { binding: 'PLATFORM_DB', database_name: 'platform_db', database_id: PLATFORM_DB },
    ],
    env: {
      sandbox: {
        d1_databases: [
          { binding: 'APP_DB', database_name: 'alpha_db_sandbox', database_id: ALPHA_SBX_APP_DB },
          { binding: 'PLATFORM_DB', database_name: 'platform_db_sandbox', database_id: SBX_PLATFORM_DB },
        ],
      },
    },
  },
  'services/beta-api/wrangler.jsonc': {
    name: 'beta-api',
    d1_databases: [
      { binding: 'APP_DB', database_name: 'beta_db', database_id: BETA_APP_DB },
      { binding: 'PLATFORM_DB', database_name: 'platform_db', database_id: PLATFORM_DB },
    ],
  },
  'apps/alpha/app.yaml': 'id: alpha\nhosts:\n  web: alpha.example.com\n  api: alpha-api.example.com\n',
  'apps/beta/app.yaml': 'id: beta\nhosts:\n  web: beta.example.com\n  api: beta-api.example.com\n',
});

/** `read(repoRelativePath)` over a fixture; a wrangler file comes back as JSONC
 *  with a comment in it, as the real ones are. */
const reader = (f) => (rel) => {
  if (!(rel in f)) throw new Error(`ENOENT: no fixture file ${rel}`);
  const v = f[rel];
  return typeof v === 'string' ? v : `// fixture ${rel}\n${JSON.stringify(v, null, 2)}\n`;
};

const TWO_APPS = ['alpha', 'beta'];

/** assert.throws predicate: a BackendRefused whose message matches `re`. */
const refused = (re) => (e) => {
  assert.ok(e instanceof BackendRefused, `expected BackendRefused, got ${e}`);
  assert.match(e.message, re);
  return true;
};

describe('backendOf: one app id, its own databases', () => {
  test('RC4 · a two-app tree resolves a distinct appDb per app, and the shared platformDb', () => {
    const f = fixture();
    const alpha = backendOf('alpha', { read: reader(f), appIds: TWO_APPS });
    const beta = backendOf('beta', { read: reader(f), appIds: TWO_APPS });
    assert.deepEqual(alpha, { appDb: ALPHA_APP_DB, platformDb: PLATFORM_DB, apiHost: 'alpha-api.example.com' });
    assert.deepEqual(beta, { appDb: BETA_APP_DB, platformDb: PLATFORM_DB, apiHost: 'beta-api.example.com' });
  });

  test('RC4 · two apps binding the same APP_DB throw, naming both files', () => {
    const f = fixture();
    f['services/beta-api/wrangler.jsonc'].d1_databases[0].database_id = ALPHA_APP_DB;
    assert.throws(
      () => backendOf('alpha', { read: reader(f), appIds: TWO_APPS }),
      refused(/services\/alpha-api\/wrangler\.jsonc and services\/beta-api\/wrangler\.jsonc both bind APP_DB to the same database/),
    );
  });

  test('RC4 · the same collision is refused from the other app too', () => {
    const f = fixture();
    f['services/beta-api/wrangler.jsonc'].d1_databases[0].database_id = ALPHA_APP_DB;
    assert.throws(
      () => backendOf('beta', { read: reader(f), appIds: TWO_APPS }),
      refused(/services\/beta-api\/wrangler\.jsonc and services\/alpha-api\/wrangler\.jsonc both bind APP_DB/),
    );
  });

  test('RC5 · a wrangler without APP_DB throws, naming the file and the binding', () => {
    const f = fixture();
    f['services/alpha-api/wrangler.jsonc'].d1_databases = [
      { binding: 'PLATFORM_DB', database_name: 'platform_db', database_id: PLATFORM_DB },
    ];
    assert.throws(
      () => backendOf('alpha', { read: reader(f), appIds: TWO_APPS }),
      refused(/services\/alpha-api\/wrangler\.jsonc the top level declares no D1 binding APP_DB/),
    );
  });

  test('a wrangler without PLATFORM_DB throws, naming the file and the binding', () => {
    const f = fixture();
    f['services/beta-api/wrangler.jsonc'].d1_databases = [
      { binding: 'APP_DB', database_name: 'beta_db', database_id: BETA_APP_DB },
    ];
    assert.throws(
      () => backendOf('beta', { read: reader(f), appIds: TWO_APPS }),
      refused(/services\/beta-api\/wrangler\.jsonc the top level declares no D1 binding PLATFORM_DB/),
    );
  });

  test('a database_id that is not a D1 id (a UUID) throws, so file text never reaches a request URL (CodeQL #467)', () => {
    for (const bad of ['alpha-db', '11111111-1111-4111-8111-111111111111/../x', '11111111-1111-4111-8111-11111111111', ' 11111111-1111-4111-8111-111111111111']) {
      const f = fixture();
      f['services/alpha-api/wrangler.jsonc'].d1_databases[0].database_id = bad;
      assert.throws(
        () => backendOf('alpha', { read: reader(f), appIds: TWO_APPS }),
        refused(/binding APP_DB has a database_id that is not a D1 id \(a UUID\)/),
        JSON.stringify(bad),
      );
    }
  });

  test('an APP_DB binding with an empty database_id throws', () => {
    const f = fixture();
    f['services/alpha-api/wrangler.jsonc'].d1_databases[0].database_id = '';
    assert.throws(
      () => backendOf('alpha', { read: reader(f), appIds: TWO_APPS }),
      refused(/services\/alpha-api\/wrangler\.jsonc the top level binding APP_DB has no database_id/),
    );
  });

  test('an app id with no Worker config throws, naming the file it looked for', () => {
    assert.throws(
      () => backendOf('gamma', { read: reader(fixture()), appIds: TWO_APPS }),
      refused(/services\/gamma-api\/wrangler\.jsonc could not be read and parsed/),
    );
  });

  test('an app id that is not a plain slug is refused before any read', () => {
    const neverRead = () => {
      throw new Error('read called');
    };
    assert.throws(() => backendOf('../platform', { read: neverRead, appIds: [] }), refused(/is not a plain slug/));
  });

  test('an app.yaml with no hosts.api throws for production', () => {
    const f = fixture();
    f['apps/alpha/app.yaml'] = 'id: alpha\nhosts:\n  web: alpha.example.com\n';
    assert.throws(
      () => backendOf('alpha', { read: reader(f), appIds: TWO_APPS }),
      refused(/apps\/alpha\/app\.yaml declares no `hosts\.api`/),
    );
  });
});

describe('backendOf: env sandbox reads the env.sandbox block', () => {
  test('the sandbox ids come back, and apiHost is null (no app.yaml read)', () => {
    const f = fixture();
    delete f['apps/alpha/app.yaml'];
    assert.deepEqual(backendOf('alpha', { env: 'sandbox', read: reader(f), appIds: TWO_APPS }), {
      appDb: ALPHA_SBX_APP_DB,
      platformDb: SBX_PLATFORM_DB,
      apiHost: null,
    });
  });

  test('an app with no env.sandbox block throws, naming the block', () => {
    assert.throws(
      () => backendOf('beta', { env: 'sandbox', read: reader(fixture()), appIds: TWO_APPS }),
      refused(/services\/beta-api\/wrangler\.jsonc has no `env\.sandbox` block/),
    );
  });

  test('a production id equal to another app sandbox id is not a same-env collision', () => {
    const f = fixture();
    f['services/beta-api/wrangler.jsonc'].d1_databases[0].database_id = ALPHA_SBX_APP_DB;
    assert.equal(backendOf('alpha', { env: 'sandbox', read: reader(f), appIds: TWO_APPS }).appDb, ALPHA_SBX_APP_DB);
  });
});

describe('appIdsWithWorker: the apps the cross-app check reads', () => {
  test('lists every services/<id>-api holding a wrangler.jsonc, and nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-backend-'));
    try {
      mkdirSync(join(root, 'services', 'alpha-api'), { recursive: true });
      writeFileSync(join(root, 'services', 'alpha-api', 'wrangler.jsonc'), '{}');
      mkdirSync(join(root, 'services', 'beta-api'), { recursive: true });
      writeFileSync(join(root, 'services', 'beta-api', 'wrangler.jsonc'), '{}');
      mkdirSync(join(root, 'services', 'empty-api'), { recursive: true });
      mkdirSync(join(root, 'services', 'platform'), { recursive: true });
      writeFileSync(join(root, 'services', 'platform', 'wrangler.jsonc'), '{}');
      assert.deepEqual(appIdsWithWorker(root), ['alpha', 'beta']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a root read from disk refuses the collision without an appIds list', () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-backend-'));
    try {
      const f = fixture();
      f['services/beta-api/wrangler.jsonc'].d1_databases[0].database_id = ALPHA_APP_DB;
      for (const rel of ['services/alpha-api/wrangler.jsonc', 'services/beta-api/wrangler.jsonc', 'apps/alpha/app.yaml']) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), reader(f)(rel));
      }
      assert.throws(() => backendOf('alpha', { root }), refused(/both bind APP_DB to the same database/));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** A leg register holding `apps` as given, read through `read`. */
const registerReader = (apps) => (rel) => {
  if (rel !== 'tooling/e2e-leg-register.json') throw new Error(`ENOENT: no fixture file ${rel}`);
  return JSON.stringify({ apps });
};

describe('e2eAppOf: the app\'s tables, from the leg register', () => {
  test('returns userTables and rowTable for the app named', () => {
    const read = registerReader({ alpha: { userTables: ['alpha_rows', 'alpha_parents'], rowTable: 'alpha_rows' } });
    assert.deepEqual(e2eAppOf('alpha', { read }), { userTables: ['alpha_rows', 'alpha_parents'], rowTable: 'alpha_rows' });
  });

  test('an app with no register entry throws, naming the key', () => {
    const read = registerReader({ alpha: { userTables: ['alpha_rows'], rowTable: 'alpha_rows' } });
    assert.throws(() => e2eAppOf('beta', { read }), refused(/tooling\/e2e-leg-register\.json has no `apps\.beta` entry/));
  });

  test('a table name that is not a plain identifier throws', () => {
    const read = registerReader({ alpha: { userTables: ['alpha_rows; DROP TABLE x'], rowTable: 'alpha_rows' } });
    assert.throws(() => e2eAppOf('alpha', { read }), refused(/`apps\.alpha\.userTables` must be a non-empty list of plain table names/));
  });

  test('an empty userTables throws', () => {
    const read = registerReader({ alpha: { userTables: [], rowTable: 'alpha_rows' } });
    assert.throws(() => e2eAppOf('alpha', { read }), refused(/`apps\.alpha\.userTables` must be a non-empty list/));
  });

  test('a rowTable outside userTables throws', () => {
    const read = registerReader({ alpha: { userTables: ['alpha_rows'], rowTable: 'alpha_other' } });
    assert.throws(() => e2eAppOf('alpha', { read }), refused(/`apps\.alpha\.rowTable` must be one of its userTables/));
  });
});

describe('backendOf: the real tree', () => {
  test('GREEN CONTROL · subscriptiontracker resolves, production and sandbox apart', () => {
    const prod = backendOf('subscriptiontracker');
    const sbx = backendOf('subscriptiontracker', { env: 'sandbox' });
    // assert.ok with a fixed message throughout: a failing comparison must not
    // print a real database id.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    assert.ok(UUID.test(prod.appDb), 'production APP_DB is not a UUID');
    assert.ok(UUID.test(prod.platformDb), 'production PLATFORM_DB is not a UUID');
    assert.ok(prod.appDb !== prod.platformDb, 'production APP_DB and PLATFORM_DB are one database');
    assert.ok(sbx.appDb !== prod.appDb, 'the sandbox APP_DB is the production one');
    assert.ok(sbx.platformDb !== prod.platformDb, 'the sandbox PLATFORM_DB is the production one');
    assert.equal(typeof prod.apiHost, 'string');
    assert.ok(prod.apiHost.length > 0);
    assert.equal(sbx.apiHost, null);
  });

  test('GREEN CONTROL · the leg register names subscriptiontracker\'s tables', () => {
    const app = e2eAppOf('subscriptiontracker');
    assert.ok(app.userTables.includes(app.rowTable));
    assert.ok(app.userTables.length > 0);
  });
});

describe('backend.mjs CLI', () => {
  const run = (args, env) =>
    spawnSync(process.execPath, [MODULE, ...args], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? '', ...env },
    });

  test('no --app is a usage error, exit 2', () => {
    const r = run([], {});
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /usage: node tooling\/e2e\/backend\.mjs --app <id>/);
  });

  test('--emit-output without $GITHUB_OUTPUT is a usage error, exit 2', () => {
    const r = run(['--app', 'subscriptiontracker', '--emit-output'], {});
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /--emit-output needs \$GITHUB_OUTPUT/);
  });

  test('an app with no Worker config is refused, exit 1', () => {
    const r = run(['--app', 'no-such-app'], {});
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /REFUSED — services\/no-such-app-api\/wrangler\.jsonc could not be read/);
  });

  test('--emit-output writes platform_db alone to $GITHUB_OUTPUT and prints no id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-backend-out-'));
    try {
      const out = join(dir, 'github_output');
      writeFileSync(out, '');
      // The sandbox block, so the value compared is never a production id.
      const r = run(['--app', 'subscriptiontracker', '--env', 'sandbox', '--emit-output'], { GITHUB_OUTPUT: out });
      assert.equal(r.status, 0, r.stderr);
      const want = backendOf('subscriptiontracker', { env: 'sandbox' });
      assert.equal(readFileSync(out, 'utf8'), `platform_db=${want.platformDb}\n`);
      assert.ok(!r.stdout.includes(want.platformDb), 'the id was printed');
      assert.ok(!r.stdout.includes(want.appDb), 'the app database id was printed');
      assert.match(r.stdout, /APP_DB and PLATFORM_DB resolved from services\/subscriptiontracker-api\/wrangler\.jsonc/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
