// ─────────────────────────────────────────────────────────────────────────────
// hostname-depth.test.mjs — assert-hostname-depth.mjs must be able to FAIL, and
// must refuse to pass over a tree it could not read.
//
// [ADR 080]. Every subject the guard names gets one mutation that adds a
// two-label NIKATRU host and must go red; the control — whose comments, prose,
// *.pages.dev origins and third-party deep hosts are all present on purpose —
// must stay green; and every coverage floor gets a tree that trips it (exit 2,
// never 0).
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
const GUARD = join(CI_DIR, 'assert-hostname-depth.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-hostdepth-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A CLEAN tree. Its comments and prose name a two-label host on purpose. */
function baseFiles() {
  return {
    'services/x-api/wrangler.jsonc': [
      '{',
      '  // x.api.nikatru.com was the ADR 079 host -- a comment, never a subject.',
      '  "name": "x-api",',
      '  "vars": { "ALLOWED_ORIGINS": "https://nikatru.com,https://x-7qg.pages.dev", "UPSTREAM": "https://a.b.example.com" },',
      '  "routes": [{ "pattern": "x-api.nikatru.com", "custom_domain": true }],',
      '}',
      '',
    ].join('\n'),
    'apps/x/app.yaml': '# x.api.nikatru.com was retired -- a comment.\nid: x\nhosts:\n  pagesOrigin: x-7qg.pages.dev\n  api: x-api.nikatru.com\n',
    'catalog/apps.json': [
      { slug: 'x', url: 'https://nikatru.com/x', origin: 'https://x-7qg.pages.dev', api: 'https://x-api.nikatru.com', listings: { web: 'https://nikatru.com/x', play: null } },
    ],
    'tooling/monitor-register.json': {
      hosts: [
        { hostname: 'x-api.nikatru.com', why: 'moved off x.api.nikatru.com (prose, not a subject)', monitor: { id: 2, name: 'X API health', type: 'GET' } },
        { hostname: 'nikatru.com', pathMonitors: [{ id: 3, name: 'X web', url: 'https://nikatru.com/x/' }] },
      ],
    },
    'tooling/channel-register.json': {
      serviceEnvironments: [{ id: 'x-api', url: 'https://x-api.nikatru.com', notes: 'was https://x.api.nikatru.com' }],
    },
    'tooling/platform-register.json': {
      servingWorker: { name: 'platform', hosts: ['platform.nikatru.com'] },
      appWorkers: [
        { name: 'x-api', hosts: ['x-api.nikatru.com'], routes: [{ id: 'h', client: { file: 'deploy.yml', expression: 'https://x-api.nikatru.com/v1/health' } }] },
      ],
    },
    'tooling/capability-register.json': { capabilities: [{ id: 'c', purpose: 'talks to a.b.example.com' }] },
    '.github/workflows/deploy.yml': [
      '# x.api.nikatru.com is gone -- a comment.',
      'on: workflow_dispatch',
      'jobs:',
      '  d:',
      '    runs-on: ubuntu-24.04',
      '    env:',
      '      API: https://x-api.nikatru.com   # was x.api.nikatru.com',
      '    steps:',
      '      - run: node smoke.mjs --url https://x-api.nikatru.com/v1/health --also https://a.b.example.com',
      '',
    ].join('\n'),
    'sites/site/_headers': [
      '# connect-src once named x.api.nikatru.com -- a comment.',
      '/*',
      "  Content-Security-Policy: default-src 'self'; connect-src 'self' https://x-api.nikatru.com https://x-7qg.pages.dev",
      '',
    ].join('\n'),
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

describe('assert-hostname-depth — the control', () => {
  test('a clean tree whose comments, prose, pages.dev and third-party hosts are deep passes', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /every declared NIKATRU hostname is the apex or one label deep/);
    assert.match(out, /workers \d+ .*app\.yaml \d+ .*catalogue \d+ .*registers \d+ .*workflows \d+ .*csp \d+/);
  });
});

describe('assert-hostname-depth — every subject can go red', () => {
  const RED = [
    ['a custom-domain route', withText('services/x-api/wrangler.jsonc', '"pattern": "x-api.nikatru.com"', '"pattern": "x.api.nikatru.com"'), /wrangler\.jsonc → routes\[0\]\.pattern = "x\.api\.nikatru\.com": "x\.api\.nikatru\.com" is 2 labels below nikatru\.com/],
    ['a wildcard route', withText('services/x-api/wrangler.jsonc', '"pattern": "x-api.nikatru.com"', '"pattern": "*.api.nikatru.com/*"'), /routes\[0\]\.pattern = .*"\*\.api\.nikatru\.com" is 2 labels/],
    ['a host inside a var', withText('services/x-api/wrangler.jsonc', 'https://nikatru.com,', 'https://www.x.nikatru.com,'), /vars\.ALLOWED_ORIGINS = .*"www\.x\.nikatru\.com" is 2 labels/],
    ['an app.yaml host', withText('apps/x/app.yaml', '  api: x-api.nikatru.com', '  api: x.api.nikatru.com'), /app\.yaml → hosts\.api = "x\.api\.nikatru\.com"/],
    ['the catalogue api', withJson('catalog/apps.json', (c) => { c[0].api = 'https://x.api.nikatru.com'; return c; }), /catalog\/apps\.json\[0\] → api/],
    ['a monitored hostname', withJson('tooling/monitor-register.json', (m) => { m.hosts[0].hostname = 'x.api.nikatru.com'; return m; }), /monitor-register\.json → hosts\[0\]\.hostname/],
    ['a monitor url', withJson('tooling/monitor-register.json', (m) => { m.hosts[1].pathMonitors[0].url = 'https://app.x.nikatru.com/'; return m; }), /hosts\[1\]\.pathMonitors\[0\]\.url/],
    ['a service environment url', withJson('tooling/channel-register.json', (r) => { r.serviceEnvironments[0].url = 'https://x.api.nikatru.com'; return r; }), /channel-register\.json → serviceEnvironments\[0\]\.url/],
    ['a platform-register host', withJson('tooling/platform-register.json', (p) => { p.appWorkers[0].hosts.push('x.api.nikatru.com'); return p; }), /platform-register\.json → appWorkers\[0\]\.hosts\[1\]/],
    ['a platform-register client expression', withJson('tooling/platform-register.json', (p) => { p.appWorkers[0].routes[0].client.expression = 'https://x.api.nikatru.com/v1/health'; return p; }), /routes\[0\]\.client\.expression/],
    ['a capability-register url', withJson('tooling/capability-register.json', (c) => { c.capabilities[0].url = 'https://cap.x.nikatru.com'; return c; }), /capability-register\.json → capabilities\[0\]\.url/],
    ['a workflow env value', withText('.github/workflows/deploy.yml', '      API: https://x-api.nikatru.com', '      API: https://x.api.nikatru.com'), /deploy\.yml:7 → line/],
    ['a workflow --url argument', withText('.github/workflows/deploy.yml', '--url https://x-api.nikatru.com/v1/health', '--url https://x.api.nikatru.com/v1/health'), /deploy\.yml:9 → line/],
    ['a CSP connect-src host', withText('sites/site/_headers', "connect-src 'self' https://x-api.nikatru.com", "connect-src 'self' https://x.api.nikatru.com"), /_headers:3 → Content-Security-Policy/],
    ['a host under the second zone', withJson('tooling/monitor-register.json', (m) => { m.hosts.push({ hostname: 'a.b.rajasekarselvam.com' }); return m; }), /"a\.b\.rajasekarselvam\.com" is 2 labels below rajasekarselvam\.com/],
  ];
  for (const [what, mutate, names] of RED) {
    test(`${what} two labels deep exits 1 and names the file and field`, () => {
      const { code, out } = run(tree(mutate));
      assert.equal(code, 1, out);
      assert.match(out, names);
      assert.match(out, /\[ADR 080\]/);
    });
  }
});

describe('assert-hostname-depth — the retired api-<app> prefix form ([ADR 080] §3)', () => {
  // 🔴 EVERY MUTATION HERE IS ONE LABEL DEEP. If limb 2 is removed, limb 1 passes
  // all of them — which is exactly what happened to the app template between
  // 2026-09-11 and 2026-09-12.
  const RED = [
    ['a custom-domain route', withText('services/x-api/wrangler.jsonc', '"pattern": "x-api.nikatru.com"', '"pattern": "api-x.nikatru.com"'), /routes\[0\]\.pattern = .*"api-x\.nikatru\.com" uses the RETIRED PREFIX form/],
    ['an app.yaml host', withText('apps/x/app.yaml', '  api: x-api.nikatru.com', '  api: api-x.nikatru.com'), /app\.yaml → hosts\.api = .*uses the RETIRED PREFIX form/],
    ['the catalogue api', withJson('catalog/apps.json', (c) => { c[0].api = 'https://api-x.nikatru.com'; return c; }), /catalog\/apps\.json\[0\] → api/],
    ['a monitored hostname', withJson('tooling/monitor-register.json', (m) => { m.hosts[0].hostname = 'api-auth.nikatru.com'; return m; }), /"api-auth\.nikatru\.com" uses the RETIRED PREFIX form/],
    ['a host under the second zone', withJson('tooling/monitor-register.json', (m) => { m.hosts.push({ hostname: 'api-x.rajasekarselvam.com' }); return m; }), /api-<app>\.rajasekarselvam\.com/],
  ];
  for (const [what, mutate, names] of RED) {
    test(`${what} in the api-<app> form exits 1 and names the file and field`, () => {
      const { code, out } = run(tree(mutate));
      assert.equal(code, 1, out);
      assert.match(out, names);
      assert.match(out, /\[ADR 080\] §3/);
    });
  }

  // The SUFFIX form is the whole point of the rule — a limb that reddened
  // `auth-api` too would be unusable, since that is the live sign-in host.
  test('the suffix form passes, including a host that is nothing but the word api', () => {
    for (const host of ['auth-api.nikatru.com', 'x-api.nikatru.com']) {
      const { code, out } = run(tree(withJson('tooling/monitor-register.json', (m) => { m.hosts.push({ hostname: host }); return m; })));
      assert.equal(code, 0, `${host}: ${out}`);
    }
  });

  // `api.nikatru.com` was the pre-079 shared host. It is retired, but it is not
  // the PREFIX form and this limb must not claim it is — a finding that names the
  // wrong rule sends the reader to the wrong ADR.
  test('a bare api host is not reported as the prefix form', () => {
    const { code, out } = run(tree(withJson('tooling/monitor-register.json', (m) => { m.hosts.push({ hostname: 'api.nikatru.com' }); return m; })));
    assert.equal(code, 0, out);
  });
});

describe('assert-hostname-depth — COVERAGE LOST, never a pass', () => {
  const EMPTY = [
    ['no Worker config', (f) => { delete f['services/x-api/wrangler.jsonc']; return f; }, /no services\/\*\/wrangler\.json\(c\) was found/],
    ['Worker configs naming no NIKATRU host', (f) => withText('services/x-api/wrangler.jsonc', 'https://nikatru.com,', 'https://example.org,')(withText('services/x-api/wrangler.jsonc', '"pattern": "x-api.nikatru.com"', '"pattern": "x.example.org"')(f)), /declare no NIKATRU hostname in `routes` or `vars`/],
    ['no app.yaml', (f) => { delete f['apps/x/app.yaml']; return f; }, /no apps\/\*\/app\.yaml was found/],
    ['an empty catalogue', withJson('catalog/apps.json', () => []), /catalog\/apps\.json lists no app/],
    ['no monitor register', (f) => { delete f['tooling/monitor-register.json']; return f; }, /monitor-register\.json does not exist/],
    ['registers naming no NIKATRU host', (f) => {
      f['tooling/monitor-register.json'] = { hosts: [] };
      f['tooling/channel-register.json'] = { serviceEnvironments: [] };
      f['tooling/platform-register.json'] = { appWorkers: [] };
      return f;
    }, /carry no NIKATRU hostname under a host-bearing key/],
    ['no workflow', (f) => { delete f['.github/workflows/deploy.yml']; return f; }, /no \.github\/workflows\/\*\.yml was found/],
    ['no CSP line', (f) => { delete f['sites/site/_headers']; return f; }, /no Content-Security-Policy line was found/],
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

describe('assert-hostname-depth — the real repository', () => {
  test('every hostname this tree declares is the apex or one label deep', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
  });
});
