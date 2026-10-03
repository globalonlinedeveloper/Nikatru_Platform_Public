// ─────────────────────────────────────────────────────────────────────────────
// capture-backend.test.mjs — the backend a store capture drives, and what it
// refuses (tooling/store/capture-backend.mjs).
//
// Row O-STORE-CAPTURE-WRITES-UNATTRIBUTED-ROWS: captures run against a
// non-production endpoint. B1 reads the REAL two wrangler.jsonc files; every
// other case hands the module fixture wrangler text through `read`, so a case
// names exactly the one key it breaks. Each case is written out by hand.
//
// Run:  node --test tooling/ci/test/capture-backend.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-26 · the fixture database ids are UUIDs: backend.mjs now refuses a database_id that is not a D1 id
// (CodeQL #467, #966), so the old placeholder names would stop every case at that refusal instead of its own.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  CAPTURE_WORKERS,
  REGISTER_REL,
  captureWorkersOf,
  CaptureBackendRefused,
  assertCaptureDefines,
  backendDefinesForRun,
  captureBackendDefines,
  sandboxBackend,
} from '../../store/capture-backend.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODULE = join(REPO, 'tooling', 'store', 'capture-backend.mjs');

/** The Supabase project the fixtures' sandbox Workers verify tokens against. */
const SUPA = 'https://fixture-project.supabase.co';

/** Two Worker configs shaped like the real ones: a routed top level with its own
 *  ids, and an `env.sandbox` that declares every key it must. A fresh copy per
 *  call, so a case can break one key without touching another case. */
const fixture = () => ({
  platform: {
    name: 'platform',
    routes: [{ pattern: 'platform.example.com', custom_domain: true }],
    d1_databases: [{ binding: 'PLATFORM_DB', database_name: 'platform_db', database_id: '22222222-2222-4222-8222-000000000001' }],
    kv_namespaces: [{ binding: 'CONFIG_KV', id: 'top-config-kv' }],
    ratelimits: [{ name: 'EVENTS_LIMITER', namespace_id: '1001', simple: { limit: 120, period: 60 } }],
    env: {
      sandbox: {
        routes: [],
        workers_dev: true,
        triggers: { crons: [] },
        vars: { SUPABASE_URL: SUPA },
        d1_databases: [{ binding: 'PLATFORM_DB', database_name: 'platform_db_sandbox', database_id: '22222222-2222-4222-8222-00000000000b' }],
        kv_namespaces: [{ binding: 'CONFIG_KV', id: 'sbx-config-kv' }],
        ratelimits: [{ name: 'EVENTS_LIMITER', namespace_id: '1007', simple: { limit: 120, period: 60 } }],
      },
    },
  },
  'subscriptiontracker-api': {
    name: 'subscriptiontracker-api',
    routes: [{ pattern: 'subscriptiontracker-api.example.com', custom_domain: true }],
    d1_databases: [
      { binding: 'APP_DB', database_name: 'subscriptiontracker_db', database_id: '11111111-1111-4111-8111-000000000001' },
      { binding: 'PLATFORM_DB', database_name: 'platform_db', database_id: '22222222-2222-4222-8222-000000000001' },
    ],
    env: {
      sandbox: {
        routes: [],
        workers_dev: true,
        triggers: { crons: [] },
        vars: { SUPABASE_URL: SUPA },
        d1_databases: [
          { binding: 'APP_DB', database_name: 'subscriptiontracker_db_sandbox', database_id: '11111111-1111-4111-8111-00000000000b' },
          { binding: 'PLATFORM_DB', database_name: 'platform_db_sandbox', database_id: '22222222-2222-4222-8222-00000000000b' },
        ],
      },
    },
  },
});

/** The fixture's two Workers, as the register names them today. */
const CAPTURE_WORKERS_FIXTURE = {
  platform: 'services/platform/wrangler.jsonc',
  'subscriptiontracker-api': 'services/subscriptiontracker-api/wrangler.jsonc',
};

/** `read(repoRelativePath)` over a fixture, as JSONC with a comment in it. */
const reader = (f) => (rel) => {
  const worker = Object.entries(CAPTURE_WORKERS_FIXTURE).find(([, p]) => p === rel)?.[0];
  if (!worker) throw new Error(`unexpected read of ${rel}`);
  return `// fixture for ${worker}\n${JSON.stringify(f[worker], null, 2)}\n`;
};

/** assert.throws predicate: a CaptureBackendRefused on `limb` whose message matches `re`. */
const refusedOn = (limb, re) => (e) => {
  assert.ok(e instanceof CaptureBackendRefused, `expected CaptureBackendRefused, got ${e}`);
  assert.equal(e.limb, limb, e.message);
  assert.match(e.message, re);
  return true;
};

describe('capture-backend: the sandbox is computed from the wrangler configs', () => {
  test('B0: the Worker set is the REGISTER\'s serving Worker and app Workers, never a literal and never an edge Worker', () => {
    const reg = JSON.parse(readFileSync(join(REPO, REGISTER_REL), 'utf8'));
    assert.deepEqual(CAPTURE_WORKERS, captureWorkersOf(reg));
    assert.deepEqual(Object.keys(CAPTURE_WORKERS), [reg.servingWorker.name, ...reg.appWorkers.map((w) => w.name)]);
    for (const e of reg.edgeWorkers ?? []) assert.equal(Object.hasOwn(CAPTURE_WORKERS, e.name), false, `${e.name} is an edge Worker`);
    const two = captureWorkersOf({
      servingWorker: { name: 'platform', config: 'services/platform/wrangler.jsonc' },
      appWorkers: [
        { name: 'subscriptiontracker-api', config: 'services/subscriptiontracker-api/wrangler.jsonc' },
        { name: 'zzz-api', config: 'services\\zzz-api\\wrangler.jsonc' },
      ],
      edgeWorkers: [{ name: 'edge-shield', config: 'services/edge-shield/wrangler.jsonc' }],
    });
    assert.deepEqual(two, {
      platform: 'services/platform/wrangler.jsonc',
      'subscriptiontracker-api': 'services/subscriptiontracker-api/wrangler.jsonc',
      'zzz-api': 'services/zzz-api/wrangler.jsonc',
    });
    assert.deepEqual(captureWorkersOf(null), {});
  });

  test('🔴 B0b: a two-app register whose app #2 has no env.sandbox is REFUSED by name — it is in the set now', () => {
    const f = fixture();
    const workers = { ...CAPTURE_WORKERS_FIXTURE, 'zzz-api': 'services/zzz-api/wrangler.jsonc' };
    const read = (rel) => {
      if (rel === 'services/zzz-api/wrangler.jsonc') {
        return JSON.stringify({ name: 'zzz-api', routes: [{ pattern: 'zzz-api.example.com', custom_domain: true }] });
      }
      return reader(f)(rel);
    };
    assert.throws(() => sandboxBackend({ read, workers }), refusedOn('env-missing', /services\/zzz-api\/wrangler\.jsonc has no `env\.sandbox` block, so zzz-api/));
    assert.throws(() => sandboxBackend({ read, workers: {} }), refusedOn('unreadable', /names no serving Worker `platform`/));
  });

  test('🔴 B0c: a sandbox bound to the PRODUCTION bucket or the production Worker by service binding is refused as id-reuse', () => {
    const bucket = fixture();
    bucket.platform.r2_buckets = [{ binding: 'BACKUPS_R2', bucket_name: 'nikatru-backups' }];
    bucket.platform.env.sandbox.r2_buckets = [{ binding: 'BACKUPS_R2', bucket_name: 'nikatru-backups' }];
    assert.throws(() => sandboxBackend({ read: reader(bucket) }), refusedOn('id-reuse', /r2:BACKUPS_R2 = nikatru-backups is also the platform top-level r2:BACKUPS_R2/));
    const svc = fixture();
    svc.platform.services = [{ binding: 'ERASURE_SUBSCRIPTIONTRACKER', service: 'subscriptiontracker-api', entrypoint: 'ErasureEntrypoint' }];
    svc.platform.env.sandbox.services = [{ binding: 'ERASURE_SUBSCRIPTIONTRACKER', service: 'subscriptiontracker-api', entrypoint: 'ErasureEntrypoint' }];
    assert.throws(() => sandboxBackend({ read: reader(svc) }), refusedOn('id-reuse', /service:ERASURE_SUBSCRIPTIONTRACKER = subscriptiontracker-api is also the platform top-level/));
    // Green control: the same bindings on SANDBOX resources are accepted.
    svc.platform.env.sandbox.services[0].service = 'subscriptiontracker-api-sandbox';
    bucket.platform.env.sandbox.r2_buckets[0].bucket_name = 'nikatru-backups-sandbox';
    assert.equal(sandboxBackend({ read: reader(svc) }).platform.sandboxIds['service:ERASURE_SUBSCRIPTIONTRACKER'], 'subscriptiontracker-api-sandbox');
    assert.equal(sandboxBackend({ read: reader(bucket) }).platform.sandboxIds['r2:BACKUPS_R2'], 'nikatru-backups-sandbox');
  });

  test('B1: the REAL configs give the two -sandbox workers.dev hosts, the sandbox ids and the pin', () => {
    const b = sandboxBackend();
    assert.equal(b.platform.scriptName, 'platform-sandbox');
    assert.equal(b.platform.sandboxHost, 'https://platform-sandbox.nikatru.workers.dev');
    assert.equal(b['subscriptiontracker-api'].scriptName, 'subscriptiontracker-api-sandbox');
    assert.equal(b['subscriptiontracker-api'].sandboxHost, 'https://subscriptiontracker-api-sandbox.nikatru.workers.dev');
    // ⏱ 2026-10-01 (rv2-services-022): the two namespaces tooling/scripts/provision-sandbox-twins.mjs
    // creates are not pinned by value here — their ids exist only once it has run, and limb 8 of
    // assert-platform-register.mjs refuses the placeholder they carry until then. What IS pinned:
    // each is a KV id, and the revocation list is ONE namespace across the two sandbox Workers.
    const { 'kv:SESSION_REVOKED': revoked, 'kv:SIGNUPS': signups, ...platformPinned } = b.platform.sandboxIds;
    const { 'kv:SESSION_REVOKED': apiRevoked, ...apiPinned } = b['subscriptiontracker-api'].sandboxIds;
    assert.match(revoked, /^[0-9a-f]{32}$/);
    assert.match(signups, /^[0-9a-f]{32}$/);
    assert.equal(apiRevoked, revoked, 'the sandbox revocation list must be the one namespace the platform sandbox writes');
    assert.deepEqual(platformPinned, {
      'd1:PLATFORM_DB': 'ead92001-03e1-4f71-9b92-c64963a24925',
      'd1:SUBSCRIPTIONTRACKER_DB': '4e7c7730-3dc7-4004-9895-403b17702b91',
      'kv:CONFIG_KV': '7ba3a916f8a5429091dec4a39284bffb',
      'kv:JWKS_CACHE': 'b2acb786d12f4e36b339dd19f8812bbe',
      'r2:BACKUPS_R2': 'nikatru-backups-sandbox',
      'service:ERASURE_SUBSCRIPTIONTRACKER': 'subscriptiontracker-api-sandbox',
      'ratelimit:MONEY_CEILING_LIMITER': '1006',
      'ratelimit:EVENTS_LIMITER': '1007',
      'ratelimit:EVENTS_CEILING_LIMITER': '1008',
      'ratelimit:CONFIG_CEILING_LIMITER': '1009',
      'ratelimit:FX_CEILING_LIMITER': '1016', // ⏱ 2026-09-28 · ST-I3, the rate table's ceiling.
      'ratelimit:EXT_TOKEN_CEILING_LIMITER': '1010',
      'ratelimit:SESSIONS_LIMITER': '1012',
      'ratelimit:REMINDERS_CEILING_LIMITER': '1014', // ⏱ 2026-09-28 · ST-T4a, the public reminder routes' ceiling.
      'ratelimit:NATIVE_AUTH_ACCOUNT_LIMITER': '1019',
      'ratelimit:NATIVE_AUTH_EDGE_LIMITER': '1020',
      'ratelimit:NATIVE_AUTH_UNATTESTED_LIMITER': '1023', // ⏱ 2026-09-29 · ADR no.NNN, the unattested channel's ceiling.
      'ratelimit:NATIVE_AUTH_INSTALL_LIMITER': '1024', // ⏱ 2026-09-29 · ADR no.NNN, key registration's ceiling.
      'ratelimit:NATIVE_AUTH_PLAY_VERIFY_LIMITER': '1026', // ⏱ 2026-09-30 · ADR no.NNN, Play Integrity verifications' ceiling.
      'ratelimit:CHECKOUT_CEILING_LIMITER': '1028', // ⏱ 2026-10-01 · O-ST-CHECKOUT-UNBOUNDED, POST /v1/checkout's edge ceiling.
      'ratelimit:CHECKOUT_USER_LIMITER': '1030', // ⏱ 2026-10-01 · O-ST-CHECKOUT-UNBOUNDED, its per-user bucket.
    });
    assert.deepEqual(apiPinned, {
      'd1:APP_DB': '4e7c7730-3dc7-4004-9895-403b17702b91',
      'd1:PLATFORM_DB': 'ead92001-03e1-4f71-9b92-c64963a24925',
      'kv:JWKS_CACHE': 'b2acb786d12f4e36b339dd19f8812bbe',
      'ratelimit:WRITE_LIMITER': '1032', // ⏱ 2026-10-01 · rv2-services-008, the per-account write limiter's sandbox namespace.
    });
    const defines = captureBackendDefines({ backend: b, env: { SUPABASE_URL: b.platform.supabaseUrl } });
    assert.deepEqual(defines, [
      '--dart-define',
      'API_BASE_URL=https://subscriptiontracker-api-sandbox.nikatru.workers.dev',
      '--dart-define',
      'PLATFORM_BASE_URL=https://platform-sandbox.nikatru.workers.dev',
      '--dart-define',
      'CONFIG_BASE_URL=https://platform-sandbox.nikatru.workers.dev',
      '--dart-define',
      'PIN_BACKEND_HOSTS=true',
    ]);
    // The CLI deploy-sandbox.yml and the capture jobs' health preflight call.
    const cli = spawnSync(process.execPath, [MODULE, '--print-host', 'subscriptiontracker-api'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout.trim(), 'https://subscriptiontracker-api-sandbox.nikatru.workers.dev');
  });

  test('B2: an env carrying API_BASE_URL is refused, whatever it names', () => {
    const backend = sandboxBackend({ read: reader(fixture()) });
    assert.throws(
      () => captureBackendDefines({ backend, env: { SUPABASE_URL: SUPA, API_BASE_URL: 'https://subscriptiontracker-api.nikatru.com' } }),
      refusedOn('supplied-host', /API_BASE_URL is set in this environment/),
    );
  });

  test('B3: an env carrying PLATFORM_BASE_URL is refused', () => {
    const backend = sandboxBackend({ read: reader(fixture()) });
    assert.throws(
      () => captureBackendDefines({ backend, env: { SUPABASE_URL: SUPA, PLATFORM_BASE_URL: 'https://platform.nikatru.com' } }),
      refusedOn('supplied-host', /PLATFORM_BASE_URL is set in this environment/),
    );
  });

  test('B4: a sandbox whose script is a production one is refused, and the default -sandbox name is not', () => {
    // Green control first: the fixture as written derives `<name>-sandbox`, a
    // host that no production route or workers.dev name has.
    const ok = sandboxBackend({ read: reader(fixture()) });
    assert.equal(ok.platform.sandboxHost, 'https://platform-sandbox.nikatru.workers.dev');
    assert.equal(ok.platform.productionHosts.includes(ok.platform.sandboxHost), false);
    const f = fixture();
    f.platform.env.sandbox.name = 'platform';
    assert.throws(() => sandboxBackend({ read: reader(f) }), refusedOn('script-name', /"platform", which is a production Worker/));
    // A production host that reaches the define builder anyway is refused there.
    const backend = sandboxBackend({ read: reader(fixture()) });
    backend['subscriptiontracker-api'].sandboxHost = 'https://subscriptiontracker-api.nikatru.workers.dev';
    assert.throws(
      () => captureBackendDefines({ backend, env: { SUPABASE_URL: SUPA } }),
      refusedOn('production-host', /API_BASE_URL would be https:\/\/subscriptiontracker-api\.nikatru\.workers\.dev, a production host/),
    );
  });

  test('B5: a SUPABASE_URL the sandbox Workers do not verify against is refused', () => {
    const backend = sandboxBackend({ read: reader(fixture()) });
    assert.throws(
      () => captureBackendDefines({ backend, env: { SUPABASE_URL: 'https://another-project.supabase.co' } }),
      refusedOn('supabase-mismatch', /SUPABASE_URL does not equal .* env\.sandbox vars\.SUPABASE_URL/),
    );
  });
});

describe('capture-backend: the define allowlist', () => {
  test('B6: a GLITCHTIP_DSN define is refused by name', () => {
    assert.throws(
      () => assertCaptureDefines(['--dart-define', 'SUPABASE_URL=x', '--dart-define', 'GLITCHTIP_DSN=https://k@glitchtip.example/1']),
      refusedOn('define-allowlist', /outside CAPTURE_DEFINE_ALLOWLIST: GLITCHTIP_DSN\./),
    );
  });

  test('B7: a REVENUECAT_KEY define is refused by name, in the `--dart-define=` form too', () => {
    assert.throws(
      () => assertCaptureDefines(['drive', '--dart-define=REVENUECAT_KEY=appl_x', '--dart-define', 'PIN_BACKEND_HOSTS=true']),
      refusedOn('define-allowlist', /outside CAPTURE_DEFINE_ALLOWLIST: REVENUECAT_KEY\./),
    );
  });
});

describe('capture-backend: an env.sandbox that would inherit production is refused', () => {
  test('B8: a sandbox without `routes: []` throws, since it would inherit the custom domain', () => {
    const f = fixture();
    delete f['subscriptiontracker-api'].env.sandbox.routes;
    assert.throws(
      () => sandboxBackend({ read: reader(f) }),
      refusedOn('routes', /subscriptiontracker-api\/wrangler\.jsonc env\.sandbox must declare `"routes": \[\]`/),
    );
  });

  test('B9: a sandbox without `workers_dev: true` throws', () => {
    const f = fixture();
    delete f.platform.env.sandbox.workers_dev;
    assert.throws(
      () => sandboxBackend({ read: reader(f) }),
      refusedOn('workers-dev', /platform\/wrangler\.jsonc env\.sandbox must declare `"workers_dev": true`/),
    );
  });

  test('B10: a sandbox id equal to a top-level id in either config throws', () => {
    const f = fixture();
    f['subscriptiontracker-api'].env.sandbox.d1_databases[0].database_id = '22222222-2222-4222-8222-000000000001';
    assert.throws(
      () => sandboxBackend({ read: reader(f) }),
      refusedOn('id-reuse', /env\.sandbox d1:APP_DB = 22222222-2222-4222-8222-000000000001 is also the .* top-level d1:PLATFORM_DB/),
    );
  });

  // O-E2E-LANE-WIRED-TO-ONE-APP: an app Worker's sandbox goes through
  // tooling/e2e/backend.mjs, the resolver a capture's purge uses for its app
  // database. Without the call this fixture passes: no id is empty or reused.
  test('B12: an app sandbox with no APP_DB binding is refused on limb `backend`, naming the file and the binding', () => {
    const f = fixture();
    f['subscriptiontracker-api'].env.sandbox.d1_databases = [
      { binding: 'PLATFORM_DB', database_name: 'platform_db_sandbox', database_id: '22222222-2222-4222-8222-00000000000b' },
    ];
    assert.throws(
      () => sandboxBackend({ read: reader(f) }),
      refusedOn('backend', /services\/subscriptiontracker-api\/wrangler\.jsonc env\.sandbox declares no D1 binding APP_DB/),
    );
  });
});

describe('capture-backend: --proof', () => {
  test('B11: --proof reads no config and gets no backend, and the allowlist still refuses', () => {
    const neverRead = () => {
      throw new Error('a --proof run read a wrangler config');
    };
    assert.deepEqual(backendDefinesForRun({ proof: true, env: { API_BASE_URL: 'https://x.example' }, read: neverRead }), []);
    // A live run over the same reader does read, and says so.
    assert.throws(() => backendDefinesForRun({ proof: false, env: {}, read: neverRead }), refusedOn('unreadable', /a --proof run read/));
    // The proof run's own defines pass; one more key outside the set does not.
    const proofDefines = ['--dart-define', 'STORE_CAPTURE_ALLOW_DEMO=true', '--dart-define', 'SKIP_REMOTE_CONFIG=true'];
    assertCaptureDefines(proofDefines);
    assert.throws(
      () => assertCaptureDefines([...proofDefines, '--dart-define', 'GLITCHTIP_DSN=x']),
      refusedOn('define-allowlist', /GLITCHTIP_DSN/),
    );
  });
});
