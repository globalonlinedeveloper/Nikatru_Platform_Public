// ─────────────────────────────────────────────────────────────────────────────
// retired-names.test.mjs — assert-retired-names.mjs must be able to FAIL, and
// must refuse to pass over a tree it could not read.
//
// [ADR 079]. Every subject the guard names gets one mutation that carries the
// retired token and must go red, the comment-only control must stay green, and
// every coverage floor gets a tree that trips it (exit 2, never 0).
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
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-retired-names.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-retired-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A small tree that is CLEAN, and whose comments name the retired token on purpose. */
function baseFiles() {
  return {
    'tooling/channel-register.json': {
      retiredIdentityTokens: { _why: ['`subly` was the working name.'], tokens: ['subly'] },
      serviceEnvironments: [{ id: 'x-api', deploymentEnvironment: 'x-api', url: 'https://x.api.example.com', name: 'X backend Worker' }],
    },
    'services/x-api/wrangler.jsonc': [
      '{',
      '  // Renamed from subly-api on 2026-09-11 -- a comment, never a subject.',
      '  "name": "x-api",',
      '  "vars": { "ALLOWED_ORIGINS": "https://example.com,https://x-7qg.pages.dev" },',
      '  "d1_databases": [{ "binding": "APP_DB", "database_name": "x_db", "database_id": "1" }],',
      '  "r2_buckets": [{ "binding": "BACKUPS", "bucket_name": "x-backups" }],',
      '  "routes": [{ "pattern": "x.api.example.com", "custom_domain": true }],',
      '}',
      '',
    ].join('\n'),
    'catalog/apps.json': [
      { slug: 'x', url: 'https://example.com/x', origin: 'https://x-7qg.pages.dev', api: 'https://x.api.example.com', listings: { web: 'https://example.com/x', play: null } },
    ],
    'apps/x/app.yaml': '# subly.example.com was retired -- a comment.\nid: x\nhosts:\n  web: x-7qg.pages.dev\n  api: x.api.example.com\n',
    'tooling/monitor-register.json': {
      hosts: [
        { hostname: 'x.api.example.com', why: 'the old subly host is gone (prose, not a subject)', monitor: { id: 2, name: 'X API health', type: 'GET' } },
        { hostname: 'example.com', pathMonitors: [{ id: 3, name: 'X web', url: 'https://example.com/x/' }] },
      ],
    },
    'tooling/platform-register.json': {
      servingWorker: { name: 'platform', config: 'services/platform/wrangler.jsonc', hosts: ['platform.example.com'] },
      appWorkers: [{ name: 'x-api', config: 'services/x-api/wrangler.jsonc', hosts: ['x.api.example.com'] }],
      bindings: [{ binding: 'APP_DB', kind: 'd1_databases' }],
    },
    '.github/workflows/e2e.yml': [
      '# SUBLY_D1_DATABASE_ID was the old name -- a comment.',
      'on: workflow_dispatch',
      'jobs:',
      '  e2e:',
      '    runs-on: ubuntu-24.04',
      '    env:',
      '      X_D1_DATABASE_ID: abc',
      '    steps:',
      '      - run: echo "${{ secrets.X_TOKEN }}"',
      '',
    ].join('\n'),
    'sites/site/_redirects': '# /subly used to redirect here -- a comment.\n/old /new 301\n',
  };
}

function tree(mutate = (f) => f) {
  const root = join(TMP, `t${seq++}`);
  const files = mutate(baseFiles());
  for (const [rel, body] of Object.entries(files)) {
    if (body === undefined) continue;
    const at = join(root, rel);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const withJson = (rel, edit) => (f) => {
  f[rel] = edit(structuredClone(f[rel]));
  return f;
};
const withText = (rel, from, to) => (f) => {
  assert.ok(f[rel].includes(from), `fixture drift: ${rel} lacks ${from}`);
  f[rel] = f[rel].replace(from, to);
  return f;
};

describe('assert-retired-names — the control', () => {
  test('a clean tree whose COMMENTS and PROSE name the retired token passes', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /no live resource name carries a retired name \(subly\)/);
    assert.match(out, /workers \d+ .*catalogue \d+ .*app\.yaml \d+ .*monitors \d+ .*platform \d+ .*services \d+ .*workflows \d+ .*redirects \d+/);
  });
});

describe('assert-retired-names — every subject can go red', () => {
  const RED = [
    ['a Worker name', withText('services/x-api/wrangler.jsonc', '"name": "x-api"', '"name": "subly-api"'), /name = "subly-api"/],
    ['a D1 database name', withText('services/x-api/wrangler.jsonc', '"database_name": "x_db"', '"database_name": "subly_db"'), /database_name = "subly_db"/],
    ['a D1 binding name', withText('services/x-api/wrangler.jsonc', '"binding": "APP_DB"', '"binding": "SUBLY_DB"'), /binding = "SUBLY_DB"/],
    ['an R2 bucket name', withText('services/x-api/wrangler.jsonc', '"bucket_name": "x-backups"', '"bucket_name": "subly-exports"'), /bucket_name = "subly-exports"/],
    ['a custom-domain hostname', withText('services/x-api/wrangler.jsonc', '"pattern": "x.api.example.com"', '"pattern": "subly.example.com"'), /routes\[0\]\.pattern = "subly\.example\.com"/],
    ['a host inside a var', withText('services/x-api/wrangler.jsonc', 'https://example.com,', 'https://subly.example.com,'), /vars\.ALLOWED_ORIGINS \(host\) = "subly\.example\.com"/],
    ['the catalogue api', withJson('catalog/apps.json', (c) => { c[0].api = 'https://api-subly.example.com'; return c; }), /api = "https:\/\/api-subly\.example\.com"/],
    ['an app.yaml host', withText('apps/x/app.yaml', '  web: x-7qg.pages.dev', '  web: subly.example.com'), /hosts\.web = "subly\.example\.com"/],
    ['a monitored hostname', withJson('tooling/monitor-register.json', (m) => { m.hosts[0].hostname = 'subly.example.com'; return m; }), /hostname = "subly\.example\.com"/],
    ['a monitor name', withJson('tooling/monitor-register.json', (m) => { m.hosts[1].pathMonitors[0].name = 'Subly web'; return m; }), /monitor name = "Subly web"/],
    ['a platform-register Worker name', withJson('tooling/platform-register.json', (p) => { p.appWorkers[0].name = 'subly-api'; return p; }), /platform-register\.json Worker .* name = "subly-api"/],
    ['a service environment url', withJson('tooling/channel-register.json', (r) => { r.serviceEnvironments[0].url = 'https://subly.example.com'; return r; }), /serviceEnvironments\[0\] → url/],
    ['a service environment name', withJson('tooling/channel-register.json', (r) => { r.serviceEnvironments[0].name = 'Subly backend Worker'; return r; }), /serviceEnvironments\[0\] → name/],
    ['a workflow env name', withText('.github/workflows/e2e.yml', '      X_D1_DATABASE_ID: abc', '      SUBLY_D1_DATABASE_ID: abc'), /env name = "SUBLY_D1_DATABASE_ID"/],
    ['a workflow secret reference', withText('.github/workflows/e2e.yml', 'secrets.X_TOKEN', 'secrets.SUBLY_TOKEN'), /secret\/var\/env reference = "SUBLY_TOKEN"/],
    ['a path redirect', withText('sites/site/_redirects', '/old /new 301', '/subly /subscriptiontracker/ 308'), /rule source = "\/subly"/],
    ['a separator- and case-variant', withText('services/x-api/wrangler.jsonc', '"name": "x-api"', '"name": "Sub-Ly_api"'), /carries the retired name "subly"/],
  ];
  for (const [what, mutate, names] of RED) {
    test(`${what} carrying the retired token exits 1 and names it`, () => {
      const { code, out } = run(tree(mutate));
      assert.equal(code, 1, out);
      assert.match(out, names);
    });
  }
});

describe('assert-retired-names — COVERAGE LOST, never a pass', () => {
  const EMPTY = [
    ['no retired tokens', withJson('tooling/channel-register.json', (r) => { r.retiredIdentityTokens.tokens = []; return r; }), /declares no `retiredIdentityTokens\.tokens`/],
    ['no channel register', (f) => { delete f['tooling/channel-register.json']; return f; }, /channel-register\.json does not exist/],
    ['no Worker config', (f) => { delete f['services/x-api/wrangler.jsonc']; return f; }, /no services\/\*\/wrangler\.json\(c\) was found/],
    ['an empty catalogue', withJson('catalog/apps.json', () => []), /catalog\/apps\.json lists no app/],
    ['no app.yaml', (f) => { delete f['apps/x/app.yaml']; return f; }, /no apps\/\*\/app\.yaml was found/],
    ['no monitored host', withJson('tooling/monitor-register.json', () => ({ hosts: [] })), /carries no `hosts`/],
    ['no Worker in the platform register', withJson('tooling/platform-register.json', () => ({ bindings: [] })), /names no Worker/],
    ['no workflow', (f) => { delete f['.github/workflows/e2e.yml']; return f; }, /no \.github\/workflows\/\*\.yml was found/],
  ];
  for (const [what, mutate, says] of EMPTY) {
    test(`${what} exits 2`, () => {
      const { code, out } = run(tree(mutate));
      assert.equal(code, 2, out);
      assert.match(out, /COVERAGE LOST/);
      assert.match(out, says);
    });
  }
});

describe('assert-retired-names — the real repository', () => {
  test('this tree carries no retired name in a live resource name', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
  });
});
