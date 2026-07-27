// ─────────────────────────────────────────────────────────────────────────────
// clone-contract.test.mjs — assert-clone-contract.mjs must be able to FAIL.
//
// [pipeline F-10] This guard was the named residual: "assert-clone-contract.mjs
// has NO test. It has the most branches, and covering four guards properly beat
// covering six shallowly." That was an honest scope decision at the time. This
// closes it.
//
// [ADR 020] is what the guard enforces: the backend is OPT-IN. The default stamp
// is client-only, talks to the SHARED platform Worker, and owns no per-app D1 or
// bucket. Only `needs_backend=true` stamps a Worker, and that Worker binds its
// own D1 *and* the shared platform_db, and still no R2.
//
// Every case below builds a fake stamped tree in a temp dir and runs the real
// guard against it with cwd set there — the guard resolves every path relative
// to cwd, so this exercises the real code with no stubbing.
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
const GUARD = join(CI_DIR, 'assert-clone-contract.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-clone-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
/** A minimally valid stamped tree. `mutate` receives helpers to break exactly
 *  one thing, so each test differs from the passing case in one dimension. */
function tree(app, { backend = false, mutate = null } = {}) {
  const root = join(TMP, `r${seq++}`);
  const appDir = join(root, 'apps', app);
  const coreDir = join(appDir, 'lib', 'core');
  mkdirSync(coreDir, { recursive: true });

  const host = backend ? `https://api-${app}.nikatru.com` : 'https://platform.nikatru.com';
  const files = {
    [join(coreDir, 'app_config.dart')]: `const String _phApiBase = '${host}';\n`,
    // Enough real source files to clear the coverage floor, as a stamped app has.
    [join(appDir, 'pubspec.yaml')]: `name: ${app}\n`,
    [join(appDir, 'analysis_options.yaml')]: 'include: package:nikatru_lints/analysis_options.yaml\n',
    [join(appDir, 'lib', 'main.dart')]: 'void main() {}\n',
    [join(coreDir, 'router.dart')]: 'class Router {}\n',
    [join(coreDir, 'theme.dart')]: 'class Theme {}\n',
  };
  for (const [p, body] of Object.entries(files)) writeFileSync(p, body);

  const api = {
    root,
    appDir,
    configPath: join(coreDir, 'app_config.dart'),
    write: (rel, body) => {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    },
    setConfig: (body) => writeFileSync(join(coreDir, 'app_config.dart'), body),
  };

  if (backend) {
    api.write(
      `services/${app}-api/wrangler.jsonc`,
      JSON.stringify(
        { name: `${app}-api`, d1_databases: [{ database_name: `${app}_db` }, { database_name: 'platform_db' }] },
        null,
        2,
      ),
    );
  }
  if (mutate) mutate(api);
  return root;
}

const run = (root, ...args) => spawnSync(process.execPath, [GUARD, ...args], { cwd: root, encoding: 'utf8' });

describe('the default stamp is CLIENT-ONLY [ADR 020]', () => {
  test('a correct client-only stamp passes', () => {
    const r = run(tree('demo'), '--client', 'demo');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /clone contract holds/);
  });

  test('a Worker stamped by default FAILS — the backend must be opt-in', () => {
    const root = tree('demo', {
      mutate: (t) => t.write('services/demo-api/wrangler.jsonc', '{}'),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /must be OPT-IN/);
  });

  test('a per-app D1 name leaking into client source FAILS', () => {
    const root = tree('demo', {
      mutate: (t) => t.write('apps/demo/lib/core/db.dart', "const x = 'demo_db';\n"),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /mentions "demo_db"/);
  });

  test('_phApiBase pointing anywhere but the shared Worker FAILS', () => {
    const root = tree('demo', {
      mutate: (t) => t.setConfig("const String _phApiBase = 'https://api-demo.nikatru.com';\n"),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not the shared platform Worker/);
  });

  test('a missing _phApiBase FAILS rather than being treated as fine', () => {
    const root = tree('demo', { mutate: (t) => t.setConfig('// nothing here\n') });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no _phApiBase/);
  });

  test('an app that was never stamped FAILS', () => {
    const root = mkdtempSync(join(TMP, 'empty-'));
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /was not stamped at all/);
  });
});

describe('the OPT-IN backend stamp [ADR 020]', () => {
  test('a correct backend stamp passes', () => {
    const r = run(tree('svc', { backend: true }), '--backend', 'svc');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /clone contract holds/);
  });

  test('needs_backend=true with no wrangler.jsonc FAILS', () => {
    const root = tree('svc', {
      backend: true,
      mutate: (t) => rmSync(join(t.root, 'services', 'svc-api', 'wrangler.jsonc')),
    });
    const r = run(root, '--backend', 'svc');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /did not stamp/);
  });

  test('unparseable wrangler.jsonc FAILS instead of being skipped', () => {
    const root = tree('svc', {
      backend: true,
      mutate: (t) => t.write('services/svc-api/wrangler.jsonc', '{ this is not json'),
    });
    const r = run(root, '--backend', 'svc');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not parseable JSONC/);
  });

  test('missing the SHARED platform_db binding FAILS', () => {
    const root = tree('svc', {
      backend: true,
      mutate: (t) =>
        t.write(
          'services/svc-api/wrangler.jsonc',
          JSON.stringify({ d1_databases: [{ database_name: 'svc_db' }] }),
        ),
    });
    const r = run(root, '--backend', 'svc');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing the SHARED platform_db/);
  });

  test('missing its own per-app D1 FAILS', () => {
    const root = tree('svc', {
      backend: true,
      mutate: (t) =>
        t.write(
          'services/svc-api/wrangler.jsonc',
          JSON.stringify({ d1_databases: [{ database_name: 'platform_db' }] }),
        ),
    });
    const r = run(root, '--backend', 'svc');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing its per-app D1/);
  });

  test('declaring r2_buckets FAILS — one portfolio bucket, never one per app', () => {
    const root = tree('svc', {
      backend: true,
      mutate: (t) =>
        t.write(
          'services/svc-api/wrangler.jsonc',
          JSON.stringify({
            d1_databases: [{ database_name: 'svc_db' }, { database_name: 'platform_db' }],
            r2_buckets: [{ bucket_name: 'svc-exports' }],
          }),
        ),
    });
    const r = run(root, '--backend', 'svc');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declares r2_buckets/);
  });

  test('a COMMENT about r2_buckets does NOT trip it — parsed, not grepped', () => {
    // The exact trap recorded in CLAUDE.md: a grep for '"r2_buckets"' once
    // matched the template comment explaining why there is no r2_buckets.
    const root = tree('svc', {
      backend: true,
      mutate: (t) =>
        t.write(
          'services/svc-api/wrangler.jsonc',
          '{\n  // no "r2_buckets" here: one portfolio bucket lives in services/platform\n' +
            '  "d1_databases": [{ "database_name": "svc_db" }, { "database_name": "platform_db" }]\n}',
        ),
    });
    const r = run(root, '--backend', 'svc');
    assert.equal(r.status, 0, r.stderr);
  });

  test('the backend stamp rendering the CLIENT branch FAILS', () => {
    const root = tree('svc', {
      backend: true,
      mutate: (t) => t.setConfig("const String _phApiBase = 'https://platform.nikatru.com';\n"),
    });
    const r = run(root, '--backend', 'svc');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /rendered the client-only branch|not this app's own API host/);
  });
});

describe('the guard itself', () => {
  test('no arguments fails loudly rather than passing vacuously', () => {
    const r = run(TMP);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /pass --client <app> and\/or --backend <app>/);
  });

  test('COVERAGE: a scan that reaches almost nothing is "broken", not "clean"', () => {
    // Strip the app back to just its config, so the banned-name walk has almost
    // nothing to read. Before 2026-07-27 this printed "ok" over an empty scan.
    const root = tree('demo');
    for (const f of ['pubspec.yaml', 'analysis_options.yaml', 'lib/main.dart', 'lib/core/router.dart', 'lib/core/theme.dart']) {
      rmSync(join(root, 'apps', 'demo', f), { force: true });
    }
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST/);
    assert.match(r.stderr, /The scan is broken, not the tree/);
  });
});
