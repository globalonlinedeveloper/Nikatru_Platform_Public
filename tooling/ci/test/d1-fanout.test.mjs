// ─────────────────────────────────────────────────────────────────────────────
// d1-fanout.test.mjs — tooling/ci/assert-d1-fanout.mjs and
// tooling/scripts/render-platform-app-block.mjs, each able to FAIL
// (row O-BACKUP-AND-FANOUT-SETS-HAND-LISTED, service kit E-c; RC14, RC15).
//
// Every tree here is a COPY of the real files the two read, in os.tmpdir() ([ADR 072]),
// mutated by one change, and both scripts run on it through `--root`. Nothing creates
// services/x-api in the real tree.
//
// Run:  node --test tooling/ci/test/d1-fanout.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJsonc } from '../d1-stores.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-d1-fanout.mjs');
const RENDER = join(REPO, 'tooling', 'scripts', 'render-platform-app-block.mjs');
const COPIED = [
  'tooling/platform-register.json',
  'services/platform/wrangler.jsonc',
  'services/platform/migrations',
  'services/platform/src/backup/index.ts',
  'services/platform/src/scheduled.ts',
  'services/platform/src/generated/app-targets.ts',
  'services/subscriptiontracker-api/wrangler.jsonc',
  'services/subscriptiontracker-api/migrations',
  // ⏱ 2026-09-28 · ST-N1: NATIVE_AUTH_APPS is read off apps/ — the files
  // assert-auth-callbacks.mjs's walk needs to call app #1 a native app.
  'apps/subscriptiontracker/app.yaml',
  'apps/subscriptiontracker/lib/state/providers/auth.dart',
  'apps/subscriptiontracker/android/app/src/main/AndroidManifest.xml',
];

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-d1-fanout-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

/** A copy of the files both scripts read; `edit(rel, text)` may rewrite one. */
function tree(edits = {}) {
  seq += 1;
  const root = join(TMP, `t${seq}`);
  for (const rel of COPIED) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel), { recursive: true });
  }
  for (const [rel, f] of Object.entries(edits)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    let before = '';
    try { before = readFileSync(join(root, rel), 'utf8'); } catch { /* a new file */ }
    writeFileSync(join(root, rel), typeof f === 'function' ? f(before) : f);
  }
  return root;
}
const run = (script, root, ...args) => {
  const r = spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const swap = (from, to) => (text) => {
  assert.ok(text.includes(from), `fixture anchor absent: ${from.slice(0, 70)}`);
  return text.replace(from, to);
};

/** A second app Worker, x-api, that OWNS a D1 — the shape provision-backend stamps. */
const X_CONFIG = `{
  // a JSONC comment, as the real configs carry
  "name": "x-api",
  "main": "src/index.ts",
  "vars": { "APP_ID": "x" },
  "d1_databases": [
    { "binding": "APP_DB", "database_name": "x_db", "database_id": "00000000-0000-4000-8000-00000000000e", "migrations_dir": "migrations" }
  ],
  "kv_namespaces": [
    { "binding": "JWKS_CACHE", "id": "bcfcb1618d1a4bfd8d02f87d3d21010d" }
  ],
  // ⏱ 2026-10-01 (rv2-services-011): the sandbox block the brick stamps, which the
  // renderer's sandbox-* regions read.
  "env": { "sandbox": {
    "vars": { "APP_ID": "x" },
    "d1_databases": [
      { "binding": "APP_DB", "database_name": "x_db_sandbox", "database_id": "00000000-0000-4000-8000-0000000000fe", "migrations_dir": "migrations" }
    ]
  } }
}
`;
const X_FILES = {
  'services/x-api/wrangler.jsonc': X_CONFIG,
  'services/x-api/migrations/0001_init.sql': 'CREATE TABLE items (id TEXT PRIMARY KEY);\n',
};
const withXRow = (text) => {
  const reg = JSON.parse(text);
  reg.appWorkers.push({ name: 'x-api', config: 'services/x-api/wrangler.jsonc', hosts: ['x-api.example.test'], routes: [], dsnSecret: 'GLITCHTIP_DSN_X' });
  return `${JSON.stringify(reg, null, 2)}\n`;
};

describe('assert-d1-fanout.mjs — every owned D1 is backed up, bound, and (an app\'s) fanned out to', () => {
  test('the real tree: green, and the log lists both databases', () => {
    const r = run(GUARD, REPO);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /platform_db \(services\/platform\/wrangler\.jsonc\): backup, binding/);
    assert.match(r.out, /subscriptiontracker_db \(services\/subscriptiontracker-api\/wrangler\.jsonc\): backup, fan-out, binding/);
  });

  test('🔴 RC14 · a scratch services/x-api that owns a D1 and has no register row is in NONE of the lists, named', () => {
    const r = run(GUARD, tree(X_FILES));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /x_db \(owned by services\/x-api\/wrangler\.jsonc\) is in NONE of the nightly backup/);
    assert.doesNotMatch(r.out, /subscriptiontracker_db \(owned by/);
  });

  test('…and with its register row rendered, the same tree is green: register → renderer → guard, end to end', () => {
    const root = tree({ ...X_FILES, 'tooling/platform-register.json': withXRow });
    const w = run(RENDER, root);
    assert.equal(w.code, 0, w.out);
    const g = run(GUARD, root);
    assert.equal(g.code, 0, g.out);
    assert.match(g.out, /x_db \(services\/x-api\/wrangler\.jsonc\): backup, fan-out, binding/);
  });

  test('🔴 the fan-out stops reading the generated module: the app database is missing from the fan-out, named', () => {
    const root = tree({
      'services/platform/src/scheduled.ts': swap(
        'return APP_TARGETS.map((t) => ({ appId: t.appId, db: (env as unknown as Record<string, D1Database | undefined>)[t.dbBinding] as D1Database }));',
        "return [{ appId: 'subscriptiontracker', db: (env as unknown as Record<string, D1Database | undefined>)['SUBSCRIPTIONTRACKER_DB'] as D1Database }];",
      ),
    });
    const r = run(GUARD, root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /subscriptiontracker_db \(owned by services\/subscriptiontracker-api\/wrangler\.jsonc\) is missing from the renewals fan-out/);
  });

  test('🔴 the backup stops spreading the generated module: the app database is missing from the nightly backup', () => {
    const root = tree({
      'services/platform/src/backup/index.ts': swap(
        '    ...APP_TARGETS.map((t) => ({ name: t.databaseName, db: bound[t.dbBinding] })),\n',
        '',
      ),
    });
    const r = run(GUARD, root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /subscriptiontracker_db .* is missing from the nightly backup/);
  });

  test('COVERAGE LOST (exit 2) when no config owns a D1, or the generated module is gone', () => {
    const none = tree({
      'services/platform/wrangler.jsonc': (t) => t.replace('"migrations_dir": "migrations"', '"x_migrations_dir_removed": "migrations"'),
      'services/subscriptiontracker-api/wrangler.jsonc': (t) => t.replace(/"migrations_dir": "migrations"/g, '"x_migrations_dir_removed": "migrations"'),
    });
    const a = run(GUARD, none);
    assert.equal(a.code, 2, a.out);
    assert.match(a.out, /COVERAGE LOST — no live wrangler config owns a D1 database/);
    const root = tree();
    rmSync(join(root, 'services/platform/src/generated/app-targets.ts'));
    const b = run(GUARD, root);
    assert.equal(b.code, 2, b.out);
    assert.match(b.out, /COVERAGE LOST — services\/platform\/src\/generated\/app-targets\.ts does not exist/);
  });
});

describe('render-platform-app-block.mjs — the per-app block is rendered from the register', () => {
  test('the real tree renders to itself (--check exit 0), and its config parses to the same JSON', () => {
    const r = run(RENDER, REPO, '--check');
    assert.equal(r.code, 0, r.out);
    assert.ok(parseJsonc(readFileSync(join(REPO, 'services/platform/wrangler.jsonc'), 'utf8')).d1_databases.length >= 2);
  });

  test("🔴 RC15 · app #1's <APP>_DB line hand-deleted inside the markers: --check exits 1, and a render puts it back", () => {
    const root = tree({ 'services/platform/wrangler.jsonc': swap('      "binding": "SUBSCRIPTIONTRACKER_DB",\n', '') });
    const c = run(RENDER, root, '--check');
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /services\/platform\/wrangler\.jsonc is not what tooling\/platform-register\.json renders/);
    assert.equal(run(RENDER, root).code, 0);
    assert.equal(readFileSync(join(root, 'services/platform/wrangler.jsonc'), 'utf8'), readFileSync(join(REPO, 'services/platform/wrangler.jsonc'), 'utf8'));
  });

  test('a second app row renders into every region and the module, and the result still parses', () => {
    const root = tree({ ...X_FILES, 'tooling/platform-register.json': withXRow });
    assert.equal(run(RENDER, root).code, 0);
    const cfg = parseJsonc(readFileSync(join(root, 'services/platform/wrangler.jsonc'), 'utf8'));
    assert.equal(cfg.vars.APP_ERASURE_ENDPOINTS, 'subscriptiontracker=https://subscriptiontracker-api.nikatru.com,x=https://x-api.example.test');
    assert.deepEqual(cfg.services.map((s) => s.binding), ['ERASURE_SUBSCRIPTIONTRACKER', 'ERASURE_X']);
    assert.deepEqual(cfg.d1_databases.map((d) => d.binding), ['PLATFORM_DB', 'SUBSCRIPTIONTRACKER_DB', 'X_DB']);
    // ⏱ 2026-10-01 (rv2-services-022): and every sandbox region, from x-api's own env.sandbox.
    const sbx = cfg.env.sandbox;
    assert.equal(
      sbx.vars.APP_ERASURE_ENDPOINTS,
      'subscriptiontracker=https://subscriptiontracker-api-sandbox.nikatru.workers.dev,x=https://x-api-sandbox.nikatru.workers.dev',
    );
    assert.deepEqual(sbx.services.map((x) => [x.binding, x.service]), [
      ['ERASURE_SUBSCRIPTIONTRACKER', 'subscriptiontracker-api-sandbox'],
      ['ERASURE_X', 'x-api-sandbox'],
    ]);
    assert.deepEqual(sbx.d1_databases.map((d) => [d.binding, d.database_name]), [
      ['PLATFORM_DB', 'platform_db_sandbox'],
      ['SUBSCRIPTIONTRACKER_DB', 'subscriptiontracker_db_sandbox'],
      ['X_DB', 'x_db_sandbox'],
    ]);
    const mod = readFileSync(join(root, 'services/platform/src/generated/app-targets.ts'), 'utf8');
    assert.match(mod, /\{ appId: 'x', dbBinding: 'X_DB', databaseName: 'x_db' \}/);
    // x-api's JWKS_CACHE IS the platform's namespace (the same id): deduplicated, not a second store.
    assert.match(mod, /export const APP_KV: readonly AppKv\[\] = \[\n\];/);
  });

  test('the copied tree renders exactly what is committed — the fixture reads every input the renderer reads', () => {
    const c = run(RENDER, tree(), '--check');
    assert.equal(c.code, 0, c.out);
  });

  test('🔴 ST-N1 · a second NATIVE app under apps/ joins NATIVE_AUTH_APPS; a web-only or non-Supabase app does not', () => {
    const providers = "final r = SupabaseAuthRepository(client, redirects: AuthRedirects.current(appId: 'x'));\n";
    const root = tree({
      'apps/budgetbuddy/app.yaml': 'id: budgetbuddy\n',
      'apps/budgetbuddy/lib/state/providers/auth.dart': providers,
      'apps/budgetbuddy/ios/Runner/Info.plist': '<plist/>\n',
      'apps/webonly/app.yaml': 'id: webonly\n',
      'apps/webonly/lib/state/providers/auth.dart': providers,
      'apps/nosupabase/app.yaml': 'id: nosupabase\n',
      'apps/nosupabase/lib/state/providers/auth.dart': 'final r = InMemoryAuthRepository();\n',
      'apps/nosupabase/android/app/src/main/AndroidManifest.xml': '<manifest/>\n',
    });
    const c = run(RENDER, root, '--check');
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /services\/platform\/src\/generated\/app-targets\.ts is not what tooling\/platform-register\.json renders/);
    assert.equal(run(RENDER, root).code, 0);
    const mod = readFileSync(join(root, 'services/platform/src/generated/app-targets.ts'), 'utf8');
    assert.match(mod, /export const NATIVE_AUTH_APPS: readonly string\[\] = \[\n  'budgetbuddy',\n  'subscriptiontracker',\n\];/);
  });

  test('🔴 refusals: an APP_ID that is not the row\'s name, an app KV the platform does not bind, a marker gone', () => {
    const badId = tree({ ...X_FILES, 'services/x-api/wrangler.jsonc': X_CONFIG.replace('"APP_ID": "x"', '"APP_ID": "y"'), 'tooling/platform-register.json': withXRow });
    const a = run(RENDER, badId);
    assert.equal(a.code, 1, a.out);
    assert.match(a.out, /declares APP_ID `y`, and the row's Worker is `x-api`/);
    const ownKv = tree({ ...X_FILES, 'services/x-api/wrangler.jsonc': X_CONFIG.replace('bcfcb1618d1a4bfd8d02f87d3d21010d', '0000000000000000000000000000000f'), 'tooling/platform-register.json': withXRow });
    const b = run(RENDER, ownKv);
    assert.equal(b.code, 1, b.out);
    assert.match(b.out, /binds KV namespace\(s\) the platform Worker does not: X_JWKS_CACHE \(0000000000000000000000000000000f\)/);
    // ⏱ 2026-10-01 (rv2-services-011/-022): an app Worker with no env.sandbox is refused, never skipped.
    const noSandbox = tree({ ...X_FILES, 'services/x-api/wrangler.jsonc': X_CONFIG.replace(/,\n  \/\/ ⏱ 2026-10-01[\s\S]*\} \}\n\}\n$/, '\n}\n'), 'tooling/platform-register.json': withXRow });
    const d = run(RENDER, noSandbox);
    assert.equal(d.code, 1, d.out);
    assert.match(d.out, /appWorkers\[1\] \(x-api\): services\/x-api\/wrangler\.jsonc declares no `env\.sandbox`/);
    const noMark = tree({ 'services/platform/wrangler.jsonc': swap('    // ── GENERATED END app-databases ──\n', '') });
    const c = run(RENDER, noMark, '--check');
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /carries 1 BEGIN and 0 END marker\(s\) for region app-databases/);
  });
});
