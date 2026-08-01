// ─────────────────────────────────────────────────────────────────────────────
// stamp-text-fidelity.test.mjs — assert-stamp-text-fidelity.mjs must be able to
// FAIL, and must REFUSE to run against a probe that cannot trigger it.
//
// [pipeline F-10] Every guard carries a recorded failing case. This one guards
// two defects that were invisible to every other check in the app_brick lane,
// because both produce output that compiles, analyzes, formats and tests clean:
//
//   1. mason HTML-escapes every DOUBLE stache (& < > " ' /), so `{{display_name}}`
//      put `Probe&#x27;s &amp; Co` into a Dart const, an ARB message, the PWA
//      manifest and the pubspec.
//   2. a BLANK `subdomain`/`api_domain` — the input pre_gen documents as normal
//      — was interpolated as nothing, stamping `"https://"` into ALLOWED_ORIGINS
//      and _phApiBase.
//
// ⚠️ A FIXTURE PASSING IS NOT A GUARD WORKING. These cases were written after
// the guard had already been mutation-proven against the REAL tree: the fix was
// `git stash`ed, both probes re-stamped by real mason 0.1.3, and the guard went
// red on 11 problems (entities in 11 files, `appName` corrupt, and
// `api_base_url` / `_phApiBase` / `ALLOWED_ORIGINS` all `"https://"`). The
// fixtures below lock in the same behaviour cheaply; they did not discover it.
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
const GUARD = join(CI_DIR, 'assert-stamp-text-fidelity.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-fidelity-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const NAME = "Probe's & Co — 24/7 Smoke";
const DESC = 'A "smoke" probe & nothing more.';

let seq = 0;

/** A faithfully stamped client-only tree, as the fixed brick produces.
 *  `mutate` breaks exactly ONE thing, so every case differs from the passing
 *  case in one dimension. */
function tree({
  app = 'probe',
  backend = false,
  name = NAME,
  desc = DESC,
  vars: varsOverride = {},
  mutate = null,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const appDir = join(root, 'apps', app);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const base = backend ? `https://api-${app}.nikatru.com` : 'https://platform.nikatru.com/v1';
  const dartName = name.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/'/g, "\\'");
  const j = (s) => JSON.stringify(s).slice(1, -1);

  const varsFile = `${app}_vars.json`;
  write(
    varsFile,
    `${JSON.stringify(
      {
        app_id: app,
        display_name: name,
        subdomain: backend ? '' : `${app}.nikatru.com`,
        api_domain: '',
        seed_hex: '6459F5',
        category: 'productivity',
        description: desc,
        needs_backend: backend,
        ...varsOverride,
      },
      null,
      2,
    )}\n`,
  );

  write(
    `apps/${app}/lib/core/app_config.dart`,
    `/// Runtime configuration for ${name}.\nclass AppConfig {\n  static const String appName = '${dartName}';\n  static const String _phApiBase = '${base}';\n}\n`,
  );
  for (const arb of ['app_en.arb', 'app_ta.arb']) {
    write(`apps/${app}/lib/l10n/${arb}`, `{\n  "appTitle": "${j(name)}"\n}\n`);
  }
  write(
    `apps/${app}/web/manifest.json`,
    `{\n  "name": "${j(name)}",\n  "short_name": "${j(name)}",\n  "description": "${j(desc)}"\n}\n`,
  );
  // The one file where mason's escaping is CORRECT, present so the exclusion is
  // exercised rather than merely asserted in a comment.
  write(`apps/${app}/web/index.html`, `<title>Probe&#x27;s &amp; Co</title>\n`);
  write(`apps/${app}/pubspec.yaml`, `name: ${app}\ndescription: "${j(name)} — a NIKATRU Cross Platform App."\n`);
  write(`apps/${app}/README.md`, `# ${name}\n\nStamped from the brick.\n`);
  for (const f of ['defaults.json', 'defaults.example.json']) {
    write(`apps/${app}/config/${f}`, `{\n  "app_id": "${app}",\n  "api_base_url": "${base}"\n}\n`);
  }
  // Filler, so the MIN_SCANNED floor reflects a real stamped tree rather than
  // being satisfied by the handful of files each assertion names.
  for (let i = 0; i < 20; i++) write(`apps/${app}/lib/features/f${i}.dart`, `// feature ${i}\nclass F${i} {}\n`);

  if (backend) {
    write(
      `services/${app}-api/wrangler.jsonc`,
      `{\n  // the allowlist is EXACT\n  "name": "${app}-api",\n  "vars": {\n    "ALLOWED_ORIGINS": "https://${app}.nikatru.com"\n  }\n}\n`,
    );
    write(`services/${app}-api/README.md`, `# ${app}-api\n\nPer-app backend for **${name}**.\n`);
  }

  if (mutate) mutate({ write, root, app });
  return { root, app, varsFile, backend };
}

function run({ root, app, varsFile, backend }) {
  const args = ['--vars', varsFile];
  if (backend) args.push('--service', `services/${app}-api`);
  const r = spawnSync(process.execPath, [GUARD, ...args], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('assert-stamp-text-fidelity', () => {
  test('a faithful client-only stamp passes', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ships the spec's text/);
  });

  test('a faithful backend stamp passes, including its derived ALLOWED_ORIGINS', () => {
    const r = run(tree({ app: 'probeapi', backend: true }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ALLOWED_ORIGINS derived to https:\/\/probeapi\.nikatru\.com/);
  });

  // ── 1 · the escaping defect, one destination at a time ────────────────────
  test('an HTML-escaped appName fails (the Dart const)', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            `apps/${app}/lib/core/app_config.dart`,
            `class AppConfig {\n  static const String appName = 'Probe&#x27;s &amp; Co — 24&#x2F;7 Smoke';\n  static const String _phApiBase = 'https://platform.nikatru.com/v1';\n}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /appName is "Probe&#x27;s/);
  });

  test('an HTML-escaped ARB app title fails (the OS task-switcher name)', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(`apps/${app}/lib/l10n/app_en.arb`, `{\n  "appTitle": "Probe&#x27;s &amp; Co"\n}\n`),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /app_en\.arb appTitle is/);
  });

  test('an HTML-escaped PWA manifest fails (the install name)', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            `apps/${app}/web/manifest.json`,
            `{\n  "name": "Probe&#x27;s",\n  "short_name": "Probe&#x27;s",\n  "description": "A &quot;smoke&quot; probe"\n}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /manifest\.json name is/);
  });

  test('an HTML-escaped pubspec description fails', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(`apps/${app}/pubspec.yaml`, `name: ${app}\ndescription: "Probe&#x27;s &amp; Co — a NIKATRU Cross Platform App."\n`),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /pubspec description starts/);
  });

  test('an entity in a file no per-field check names still fails (the class, not the instance)', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(`apps/${app}/lib/app.dart`, `/// Root widget for Probe&#x27;s &amp; Co.\nclass App {}\n`),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /HTML entity\/entities in the stamped output/);
    assert.match(r.out, /lib\/app\.dart/);
  });

  test('entities in web/index.html are NOT a failure — there the escaping is correct', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            `apps/${app}/web/index.html`,
            `<meta name="description" content="A &quot;smoke&quot; probe &amp; nothing more.">\n<title>Probe&#x27;s &amp; Co</title>\n`,
          ),
      }),
    );
    assert.equal(r.code, 0, r.out);
  });

  // ── 2 · the derivation defect ─────────────────────────────────────────────
  test('a bare "https://" in defaults.json fails — the blank var was interpolated', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(`apps/${app}/config/defaults.json`, `{\n  "api_base_url": "https://"\n}\n`),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a scheme with no host/);
  });

  test('a bare "https://" in _phApiBase fails', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            `apps/${app}/lib/core/app_config.dart`,
            `class AppConfig {\n  static const String appName = '${NAME.replace(/'/g, "\\'")}';\n  static const String _phApiBase = 'https://';\n}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /_phApiBase is "https:\/\/"/);
  });

  test('a bare "https://" in the stamped Worker ALLOWED_ORIGINS fails', () => {
    const r = run(
      tree({
        app: 'probeapi',
        backend: true,
        mutate: ({ write, app }) =>
          write(
            `services/${app}-api/wrangler.jsonc`,
            `{\n  "name": "${app}-api",\n  "vars": { "ALLOWED_ORIGINS": "https://" }\n}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ALLOWED_ORIGINS is "https:\/\/"/);
  });

  test('a client-only app pointed at its own API host fails — it has none', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(`apps/${app}/config/defaults.json`, `{\n  "api_base_url": "https://api-${app}.nikatru.com"\n}\n`),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /expected the derived "https:\/\/platform\.nikatru\.com\/v1"/);
  });

  // ── the fixture audit: a probe that cannot trigger the checks is LOST ─────
  test('COVERAGE LOST when the probe display_name holds none of & < > " \' /', () => {
    const r = run(tree({ name: 'Probe Brick Smoke Test' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /display_name/);
  });

  test('COVERAGE LOST when the probe description holds none of the escape set', () => {
    const r = run(tree({ desc: 'A plain smoke probe.' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /description/);
  });

  test('COVERAGE LOST when the probe passes BOTH hosts explicitly — the derive path is never stamped', () => {
    const r = run(
      tree({
        app: 'probeapi',
        backend: true,
        vars: { subdomain: 'probeapi.nikatru.com', api_domain: 'api-probeapi.nikatru.com' },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /both subdomain and api_domain/i);
  });

  test('COVERAGE LOST when the stamped tree is too small to have been scanned', () => {
    const r = run(
      tree({
        mutate: ({ root, app }) => {
          rmSync(join(root, 'apps', app, 'lib', 'features'), { recursive: true, force: true });
        },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /text file\(s\) of the stamped tree/);
  });

  test('COVERAGE LOST when the app was never stamped at all', () => {
    const t = tree();
    rmSync(join(t.root, 'apps', t.app), { recursive: true, force: true });
    const r = run(t);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('a missing vars file is COVERAGE LOST, not a silent pass', () => {
    const t = tree();
    const r = spawnSync(process.execPath, [GUARD, '--vars', 'no_such_vars.json'], {
      cwd: t.root,
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST/);
  });
});
