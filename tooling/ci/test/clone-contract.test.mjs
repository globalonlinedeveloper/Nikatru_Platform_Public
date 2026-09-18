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

/** [pipeline S-6] The shared platform Worker, which every real tree has and
 *  which is the ONE directory allowed to carry a cron. The fixture ships it by
 *  default because the cron limb's coverage assertion is derived from the real
 *  services/ tree: a fixture without it is a tree the scan cannot have read, and
 *  that must be COVERAGE LOST rather than a quiet pass.
 *
 *  🔴 ITS HEADER COMMENT NAMES CRONS ON PURPOSE — the real one does too, and a
 *  grep-based limb would fire on it. Prose here is the trap; the parsed object
 *  is the subject. */
const platformConfig = (crons = ['0 6 * * *']) =>
  `{
  // Scheduled work for the WHOLE portfolio lives here — one cron, one Worker,
  // staying under the per-account cron trigger cap.
  "name": "platform",
  "triggers": {
    "crons": ${JSON.stringify(crons)}
  }
}
`;

/** A minimally valid stamped tree. `mutate` receives helpers to break exactly
 *  one thing, so each test differs from the passing case in one dimension. */
/** A stamped app's dependency block. [pipeline 13]T-1a parses this rather than
 *  grepping it, so the fixture carries a COMMENT naming the banned packages —
 *  the `r2_buckets` trap this guard's header is about, pointed at pubspecs.
 *  `extra` inserts additional dependency lines verbatim. */
const stampedPubspec = (app, { extra = '', devExtra = '', block = 'dependencies' } = {}) =>
  `name: ${app}
version: 0.1.0+1
environment:
  sdk: ">=3.5.0 <4.0.0"

${block}:
  flutter:
    sdk: flutter
  # Deliberately absent: firebase_messaging, onesignal_flutter. A stamped app
  # schedules LOCALLY — no token, no push service. [13]T-1
  nikatru_core:
    path: ../../packages/core
  nikatru_platform_storage:
    path: ../../packages/platform_storage
  flutter_riverpod: ^2.5.0
${extra}
dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^6.0.0
${devExtra}`;

function tree(app, { backend = false, mutate = null, platform = platformConfig(), pubspec = null } = {}) {
  const root = join(TMP, `r${seq++}`);
  const appDir = join(root, 'apps', app);
  const coreDir = join(appDir, 'lib', 'core');
  mkdirSync(coreDir, { recursive: true });
  // ⏱ ENTRY POINTS ADDED 2026-09-06. The cron limb's subject set is directories
  // under `services/` that carry a `src/index.ts`, because [ADR 067] decision 2
  // added `services/_shared/` — the one home of the Worker chassis, inlined into
  // its carriers' bundles by esbuild and deployed by nothing, so it has no
  // wrangler.jsonc and never will. A fixture whose "Workers" have no entry point
  // models a tree that cannot exist, and would leave the limb's subject set
  // EMPTY — which its own COVERAGE LOST floor correctly refuses. The FIXTURES
  // are corrected, not the guard: these are Workers, so they have entry points.
  const workerEntry = 'export default { fetch() { return new Response("ok"); } };\n';
  if (platform !== null) {
    mkdirSync(join(root, 'services', 'platform', 'src'), { recursive: true });
    writeFileSync(join(root, 'services', 'platform', 'wrangler.jsonc'), platform);
    writeFileSync(join(root, 'services', 'platform', 'src', 'index.ts'), workerEntry);
  }

  const host = backend ? `https://${app}-api.nikatru.com` : 'https://platform.nikatru.com';
  const files = {
    [join(coreDir, 'app_config.dart')]: `const String _phApiBase = '${host}';\n`,
    // Enough real source files to clear the coverage floor, as a stamped app has.
    [join(appDir, 'pubspec.yaml')]: pubspec ?? stampedPubspec(app),
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
      // A fixture that writes a `services/<x>/wrangler.jsonc` is declaring a
      // deployed Worker, and since 2026-09-06 a deployed Worker is a directory
      // with an entry point (see the block above). Written here rather than at
      // twenty call sites so no case can forget it and silently drop out of the
      // cron limb's subject set — which would turn a red case green.
      const m = /^services\/([^/]+)\/wrangler\.jsonc$/.exec(rel.replaceAll('\\', '/'));
      if (m) {
        mkdirSync(join(root, 'services', m[1], 'src'), { recursive: true });
        writeFileSync(join(root, 'services', m[1], 'src', 'index.ts'), workerEntry);
      }
    },
    setConfig: (body) => writeFileSync(join(coreDir, 'app_config.dart'), body),
  };

  if (backend) {
    // A stamped Worker is testable: a `test` script, vitest, and a config that
    // resolves the workerd build and inherits the chassis suite. The real stamp
    // carries all four, so a fixture without them would make the limb that checks
    // it unanswerable - and every case here would be asserting about a tree the
    // template never produces.
    api.write(
      `services/${app}-api/package.json`,
      JSON.stringify(
        { name: `${app}-api`, scripts: { test: 'vitest run' }, devDependencies: { vitest: '^4.1.11' } },
        null,
        2,
      ),
    );
    api.write(
      `services/${app}-api/vitest.config.ts`,
      "export default { test: { include: ['test/**/*.test.ts', '../_shared/test/**/*.test.ts'] }, resolve: { conditions: ['workerd', 'import'] } };\n",
    );
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

  test('the shared host in a trailing COMMENT does not satisfy _phApiBase (CodeQL #11)', () => {
    const root = tree('demo', {
      mutate: (t) => t.setConfig("const String _phApiBase = 'https://evil.test'; // was platform.nikatru.com\n"),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /not the shared platform Worker/);
  });

  test('a lookalike host that STARTS with the shared host does not satisfy _phApiBase (CodeQL #11)', () => {
    const root = tree('demo', {
      mutate: (t) => t.setConfig("const String _phApiBase = 'https://platform.nikatru.com.evil.test/v1';\n"),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /not the shared platform Worker/);
  });

  test('the shared host with a path still passes — the brick renders https://platform.nikatru.com/v1', () => {
    const root = tree('demo', {
      mutate: (t) => t.setConfig("  static const String _phApiBase = 'https://platform.nikatru.com/v1';\n"),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 0, r.stderr);
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

describe('a stamped Worker must be able to run a test', () => {
  // 🔴 THE STATE THIS LIMB WAS WRITTEN AGAINST. Until 2026-09-12 the template
  // shipped no vitest, no `test` script, no vitest.config.ts and no test
  // directory - so the first thing an owner could not do with a fresh backend was
  // run its suite, and the modules carrying its security and correctness argument
  // went untested in its own resolution. Each case below removes exactly one of
  // the four pieces; the control above passes with all four.
  const backendTree = (mutate) => tree('demo', { backend: true, mutate });

  test('no `test` script is red', () => {
    const r = run(
      backendTree((api) =>
        api.write(
          'services/demo-api/package.json',
          JSON.stringify({ name: 'demo-api', devDependencies: { vitest: '^4.1.11' } }, null, 2),
        ),
      ),
      '--backend',
      'demo',
    );
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr + r.stdout, /declares no `test` script/);
    assert.match(r.stderr + r.stdout, /ships untested/);
  });

  test('no vitest devDependency is red — a `test` script with nothing to run', () => {
    const r = run(
      backendTree((api) =>
        api.write(
          'services/demo-api/package.json',
          JSON.stringify({ name: 'demo-api', scripts: { test: 'vitest run' } }, null, 2),
        ),
      ),
      '--backend',
      'demo',
    );
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr + r.stdout, /declares no `vitest` devDependency/);
  });

  test('a config that resolves the NODE build of jose is red, not merely noted', () => {
    const r = run(
      backendTree((api) =>
        api.write(
          'services/demo-api/vitest.config.ts',
          "export default { test: { include: ['test/**/*.test.ts', '../_shared/test/**/*.test.ts'] } };\n",
        ),
      ),
      '--backend',
      'demo',
    );
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr + r.stdout, /resolve\.conditions/);
    assert.match(r.stderr + r.stdout, /transport production never uses/);
  });

  test('a config that does not inherit the chassis suite is red', () => {
    const r = run(
      backendTree((api) =>
        api.write(
          'services/demo-api/vitest.config.ts',
          "export default { test: { include: ['test/**/*.test.ts'] }, resolve: { conditions: ['workerd', 'import'] } };\n",
        ),
      ),
      '--backend',
      'demo',
    );
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr + r.stdout, /none of the chassis suite/);
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

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 13]T-1a NO PUSH-TOKEN DEPENDENCY MAY ENTER A STAMPED APP.
//
// The premise held by luck: nobody had added `firebase_messaging`, and nothing
// in the repo would have noticed if they had. A push rail is not a library — it
// is a token per install, a server that stores it, a vendor console only the
// owner can reach, and a store privacy disclosure, none of which is affordable
// once per app across a portfolio.
//
// Mutation-proven against the REAL brick FIRST (2026-08-02) — each case adds the
// dependency to `tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml`,
// re-stamps `apps/probe` with mason, runs the guard, then restores from memory
// and byte-compares:
//   1. `firebase_messaging: ^15.0.0` in `dependencies`   → caught
//   2. `pushwoosh_flutter` — a vendor no exact-name list knows → caught by shape
//   3. `onesignal_flutter` in `dev_dependencies`         → caught
//   4. the `dependencies:` key renamed, so the parse finds nothing → COVERAGE LOST
//   5. a COMMENT naming all three banned packages        → STAYS GREEN
// Case 5 is the one that separates this from a grep, and case 4 is the one that
// stops "no push dependency" being printed over an empty parse.
describe('[13]T-1a a stamped app carries no push rail', () => {
  test('the ordinary stamp passes and NAMES how many dependencies it parsed', () => {
    const r = run(tree('demo'), '--client', 'demo');
    assert.equal(r.status, 0, r.stderr);
    // The count, not a bare "ok": a stamp that declares nothing must not read
    // the same as a stamp that declares no push rail.
    assert.match(r.stdout, /no push-token dependency among the \d+ declared/);
  });

  test('FAILS when a push SDK is a real dependency', () => {
    const root = tree('demo', { pubspec: stampedPubspec('demo', { extra: '  firebase_messaging: ^15.0.0\n' }) });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declares `firebase_messaging` under `dependencies`/);
    assert.match(r.stderr, /reminders are LOCAL/);
  });

  // The exact-name list only knows the vendors somebody thought of.
  test('FAILS on a push SDK no exact-name list has heard of', () => {
    const root = tree('demo', { pubspec: stampedPubspec('demo', { extra: '  pushwoosh_flutter: ^6.0.0\n' }) });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declares `pushwoosh_flutter`/);
  });

  test('FAILS when the push SDK arrives as a dev dependency', () => {
    const root = tree('demo', { pubspec: stampedPubspec('demo', { devExtra: '  onesignal_flutter: ^5.0.0\n' }) });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declares `onesignal_flutter` under `dev_dependencies`/);
  });

  // 🔴 THE CASE THAT SEPARATES THIS FROM A GREP. The fixture pubspec's comment
  // names firebase_messaging and onesignal_flutter, exactly as a real one
  // explaining their absence would.
  test('a COMMENT naming the banned packages is prose, not a dependency', () => {
    const r = run(tree('demo'), '--client', 'demo');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no push-token dependency/);
  });

  test('the backend stamp is scanned too — a Worker is not a licence to push', () => {
    const root = tree('demoapi', {
      backend: true,
      pubspec: stampedPubspec('demoapi', { extra: '  firebase_core: ^3.0.0\n' }),
      mutate: (t) =>
        t.write(
          'services/demoapi-api/wrangler.jsonc',
          JSON.stringify({ d1_databases: [{ database_name: 'demoapi_db' }, { database_name: 'platform_db' }] }),
        ),
    });
    const r = run(root, '--backend', 'demoapi');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declares `firebase_core`/);
  });

  // COVERAGE: the parse and the raw text are two readings of ONE file, and they
  // have to agree. Rename the block and the parse finds nothing — which without
  // this reports "no push dependency" over an empty set.
  test('COVERAGE LOST when the dependency parse stops finding what the file plainly declares', () => {
    const root = tree('demo', { pubspec: stampedPubspec('demo', { block: 'xdependencies' }) });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /COVERAGE LOST — the dependency parse/);
  });

  test('a pubspec that is not there at all FAILS rather than reading as clean', () => {
    const root = tree('demo');
    rmSync(join(root, 'apps', 'demo', 'pubspec.yaml'), { force: true });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /reports exactly like a clean stamp|COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline S-6] NO `crons` OUTSIDE services/platform.
//
// This limb was written into S-6's acceptance and NEVER BUILT: `grep -i cron`
// over the guard and this file both returned zero, while stage 13's T-1 and T-10
// each name [3]S-6 as their single cron enforcer. Nothing was violating it —
// there is exactly one `crons` block, in services/platform — so the gap was
// invisible: the rule held by luck, and nothing would have said otherwise.
//
// All six cases below were mutation-proven against the REAL worktree first
// (restore byte-verified), including the two FALSE-ALARM cases: a limb that
// fires on the legitimate cron home, or on a comment, is worse than no limb.
// ─────────────────────────────────────────────────────────────────────────────
describe('[S-6] cron triggers are portfolio-wide, so they live in ONE Worker', () => {
  test('the committed shape passes and names what it parsed', () => {
    const r = run(tree('demo'), '--client', 'demo');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no cron triggers outside services\/platform/);
    assert.match(r.stdout, /service config\(s\) parsed: platform/);
  });

  test('a cron in ANOTHER service FAILS, naming the file and the count', () => {
    const root = tree('demo', {
      mutate: (t) =>
        t.write('services/other-api/wrangler.jsonc', '{ "triggers": { "crons": ["0 6 * * *", "0 7 * * *"] } }'),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /services\/other-api\/wrangler\.jsonc declares 2 cron trigger\(s\)/);
    assert.match(r.stderr, /capped per ACCOUNT, not per Worker/);
  });

  // 🔴 THE FALSE-ALARM SIDE, half of the point. services/platform is the ONE
  // allowed home; a limb that fires there would make the legitimate arrangement
  // unshippable and teach everyone to disable the check.
  test('the SAME cron inside services/platform is fine', () => {
    const r = run(tree('demo'), '--client', 'demo');
    assert.equal(r.status, 0, r.stderr);
  });

  test('services/platform having NO cron at all is also fine — it is a ceiling, not a quota', () => {
    const r = run(tree('demo', { platform: '{ "name": "platform" }\n' }), '--client', 'demo');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no cron triggers outside services\/platform/);
  });

  // 🔴 NEVER A GREP. This repo already shipped a guard that matched the comment
  // explaining why there is no `r2_buckets`; the real platform config's header
  // says "cron" in prose twice, and so does this fixture's.
  test('a COMMENT naming crons in another service does NOT fire', () => {
    const root = tree('demo', {
      mutate: (t) =>
        t.write(
          'services/other-api/wrangler.jsonc',
          '{\n  // "triggers": { "crons": ["0 6 * * *"] } — deliberately NOT set: cron lives in platform.\n  "name": "other-api"\n}\n',
        ),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 0, r.stderr);
  });

  test('an EMPTY crons array is not a cron trigger', () => {
    const root = tree('demo', {
      mutate: (t) => t.write('services/other-api/wrangler.jsonc', '{ "triggers": { "crons": [] } }'),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 0, r.stderr);
  });

  // ── coverage: the scan must prove it reached the tree it claims to police ──
  test('COVERAGE LOST when a DEPLOYED Worker carries no wrangler.jsonc', () => {
    // ⏱ 2026-09-06: the fixture now gives `other-api` an ENTRY POINT, which is
    // what makes it a deployed Worker and therefore owed a config. Before this
    // it was a bare directory, and the limb's rule was "any directory under
    // services/" — a rule [ADR 067] decision 2 falsified by adding
    // `services/_shared/`. The property under test is unchanged: a Worker whose
    // config the scan cannot read is COVERAGE LOST, not a pass.
    const root = tree('demo', {
      mutate: (t) => {
        t.write('services/other-api/README.md', 'no config here\n');
        t.write('services/other-api/src/index.ts', 'export default {};\n');
      },
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /COVERAGE LOST/);
    assert.match(r.stderr, /services\/other-api\/wrangler\.jsonc — the directory exists but carries no wrangler\.jsonc/);
  });

  // 🔴 THE POSITIVE CONTROL FOR THE NARROWING, AND THE CASE THAT REDDENED CI.
  // `services/_shared/` is the one home of the Worker chassis: both Workers and
  // the brick's Worker template reach it by a relative import that esbuild
  // inlines, and NOTHING deploys it — no entry point, no wrangler.jsonc, no
  // deploy job. On 2026-09-06 this limb reported it as an unreadable Worker and
  // failed the App-brick job. Without this case the narrowing that fixed it
  // could be reverted and only a full CI run would notice.
  test('a services/ directory with NO entry point is not a Worker and is not owed a config', () => {
    const root = tree('demo', {
      mutate: (t) => {
        t.write('services/_shared/src/health.ts', 'export const READING_TTL_MS = 5000;\n');
        t.write('services/_shared/src/auth.ts', "export const bearer = (a) => a.slice(7) || null;\n");
      },
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /_shared/);
    // …and the limb still ran over the Worker that IS there, rather than being
    // switched off: services/platform is named in the passing line.
    assert.match(r.stdout, /no cron triggers outside services\/platform/);
  });

  test('COVERAGE LOST when the exempt home services/platform was never read', () => {
    const r = run(tree('demo', { platform: null, mutate: (t) => t.write('services/other-api/wrangler.jsonc', '{}') }), '--client', 'demo');
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /never read services\/platform\/wrangler\.jsonc/);
  });

  test('COVERAGE LOST when there is no services/ tree at all', () => {
    const r = run(tree('demo', { platform: null }), '--client', 'demo');
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /found no service directories under services\//);
  });

  test('COVERAGE LOST when a service config is unparseable — unknown, not clean', () => {
    const root = tree('demo', {
      mutate: (t) => t.write('services/other-api/wrangler.jsonc', '{ this is not json'),
    });
    const r = run(root, '--client', 'demo');
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /is not parseable JSONC/);
  });
});
