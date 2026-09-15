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
//   3. the telemetry `release` was a hard-coded literal naming the CI probe, so
//      all fifty apps would have reported one identity into one GlitchTip.
//   4. the short-name split fired on `RegExp(r'[—-]')` — a trailing `-` in a
//      character class is a literal hyphen — so "E-Book Reader" was published to
//      the public catalogue as "E".
//
// ⚠️ A FIXTURE PASSING IS NOT A GUARD WORKING. These cases were written after
// the guard had already been mutation-proven against the REAL tree: the fix was
// `git stash`ed, both probes re-stamped by real mason 0.1.3, and the guard went
// red on 11 problems (entities in 11 files, `appName` corrupt, and
// `api_base_url` / `_phApiBase` / `ALLOWED_ORIGINS` all `"https://"`). The
// fixtures below lock in the same behaviour cheaply; they did not discover it.
//
// Checks 3 and 4 were mutation-proven the same way on 2026-08-01, and the same
// order was kept — guard first, fixtures after. Re-introducing the literal
// release in the brick and re-stamping both probes turned the CLIENT lane red on
// the frozen version half and the BACKEND lane red on the borrowed id; restoring
// `RegExp(r'[—-]')` in post_gen.dart published "Probe's E" and "ProbeApi's Co"
// and turned both lanes red on the mid-word cut.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-stamp-text-fidelity.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-fidelity-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// The intra-word hyphen is LOAD-BEARING, exactly as in the real probe vars: a
// name without one cannot tell a subtitle separator from a hyphen, and the guard
// exits COVERAGE LOST rather than pretending it checked.
const NAME = "Probe's E-Book & Co — 24/7 Smoke";
const DESC = 'A "smoke" probe & nothing more.';
// The ICON label — a SECOND name, deliberately unlike the display name. The
// guard's own fixture audit refuses a probe whose two names are equal, because
// the manifest check would then pass against a brick that stamped either one.
const ICON = 'E-Book & Co';

/** The name the catalogue must publish: everything before the first dash that is
 *  SURROUNDED BY WHITESPACE. Spelled out here rather than imported so the test
 *  states the expectation independently of the guard's own copy. */
const shortOf = (name) => name.split(/\s+[—–-]\s+/)[0].trim();

/** The stamped `lib/core/app_config.dart`, as the fixed brick produces it. */
const configDart = ({ app, name, base, release = "'\$appId@\$appVersion'" }) => {
  const dartName = name.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/'/g, "\\'");
  return (
    `/// Runtime configuration for ${name}.\nclass AppConfig {\n` +
    `  static const String appId = '${app}';\n` +
    `  static const String appName = '${dartName}';\n` +
    "  static const String appVersion = String.fromEnvironment(\n    'APP_VERSION',\n    defaultValue: 'dev',\n  );\n" +
    `  static const String telemetryRelease = ${release};\n` +
    `  static const String _phApiBase = '${base}';\n` +
    // The define READS, not only the fallback literal: the defaults-file limb
    // grades every key in config/defaults*.json against the names this file
    // passes to String.fromEnvironment, so a fixture without them would leave
    // that limb ungradeable and the check vacuous.
    "  static const String apiBaseUrl = String.fromEnvironment(\n    'API_BASE_URL',\n    defaultValue: _phApiBase,\n  );\n" +
    "  static const String supabaseUrl = String.fromEnvironment('SUPABASE_URL');\n" +
    "  static const String supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');\n}\n"
  );
};

/** The stamped `lib/main.dart`, as the fixed brick produces it. */
const mainDart = (release = 'AppConfig.telemetryRelease') =>
  "import 'core/app_config.dart';\n\nFuture<void> main() async {\n" +
  '  const TelemetryConfig config = TelemetryConfig(\n' +
  "    dsn: String.fromEnvironment('GLITCHTIP_DSN'),\n" +
  `    release: ${release},\n` +
  "    environment: String.fromEnvironment('APP_ENV', defaultValue: 'dev'),\n  );\n" +
  '  await TelemetryBootstrap.init(config, appRunner: () async {});\n}\n';

let seq = 0;

/** A faithfully stamped client-only tree, as the fixed brick produces.
 *  `mutate` breaks exactly ONE thing, so every case differs from the passing
 *  case in one dimension. */
function tree({
  app = 'probe',
  backend = false,
  name = NAME,
  icon = ICON,
  desc = DESC,
  vars: varsOverride = {},
  mutate = null,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const base = backend ? `https://${app}-api.nikatru.com` : 'https://platform.nikatru.com/v1';
  const j = (s) => JSON.stringify(s).slice(1, -1);

  const varsFile = `${app}_vars.json`;
  write(
    varsFile,
    `${JSON.stringify(
      {
        app_id: app,
        display_name: name,
        icon_label: icon,
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

  write(`apps/${app}/lib/core/app_config.dart`, configDart({ app, name, base }));
  write(`apps/${app}/lib/main.dart`, mainDart());
  // The public catalogue row post_gen appends. It lives OUTSIDE apps/, and the
  // lane reverts it — so a fixture that omitted it would exercise the guard's
  // COVERAGE LOST path rather than its checking path.
  write(
    'catalog/apps.json',
    `${JSON.stringify(
      [
        { slug: 'subscriptiontracker', name: 'Subly', tagline: '', url: 'https://subly.nikatru.com', api: '' },
        { slug: app, name: shortOf(name), tagline: desc, url: `https://${app}.nikatru.com`, api: '' },
      ],
      null,
      2,
    )}\n`,
  );
  for (const arb of ['app_en.arb', 'app_ta.arb']) {
    write(`apps/${app}/lib/l10n/${arb}`, `{\n  "appTitle": "${j(name)}"\n}\n`);
  }
  write(
    `apps/${app}/web/manifest.json`,
    // short_name is the ICON label, not the display name — see
    // ICON_LABEL_TARGETS in tooling/app-yaml/render.mjs. Stamping the display
    // name here is the defect one of the cases below records.
    `{\n  "name": "${j(name)}",\n  "short_name": "${j(icon)}",\n  "description": "${j(desc)}"\n}\n`,
  );
  // The one file where mason's escaping is CORRECT, present so the exclusion is
  // exercised rather than merely asserted in a comment.
  write(`apps/${app}/web/index.html`, `<title>Probe&#x27;s &amp; Co</title>\n`);
  write(`apps/${app}/pubspec.yaml`, `name: ${app}\ndescription: "${j(name)} — a NIKATRU Cross Platform App."\n`);
  write(`apps/${app}/README.md`, `# ${name}\n\nStamped from the brick.\n`);
  for (const f of ['defaults.json', 'defaults.example.json']) {
    write(`apps/${app}/config/${f}`, `{\n  "//": "a comment key, skipped by name",\n  "API_BASE_URL": "${base}"\n}\n`);
  }
  // Filler, so the MIN_SCANNED floor reflects a real stamped tree rather than
  // being satisfied by the handful of files each assertion names.
  for (let i = 0; i < 20; i++) write(`apps/${app}/lib/features/f${i}.dart`, `// feature ${i}\nclass F${i} {}\n`);

  if (backend) {
    write(
      `services/${app}-api/wrangler.jsonc`,
      `{\n  // the allowlist is EXACT\n  "name": "${app}-api",\n  "vars": {\n    "ALLOWED_ORIGINS": "https://nikatru.com"\n  }\n}\n`,
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

  test('every scanned file is opened ONCE — the size cap and the bytes come from one descriptor (CodeQL #83)', () => {
    // The pre-fix shape: statSync(p) for the 512 KB cap, then readFileSync(p) — two
    // looks at one path. The spy records checks and uses of every path under the stamp.
    const t = tree();
    const out = join(TMP, `fs-spy-stf-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const spy = pathToFileURL(join(CI_DIR, 'test', 'fixtures', 'fs-spy-preload.mjs')).href;
    const r = spawnSync(process.execPath, ['--import', spy, GUARD, '--vars', t.varsFile], {
      cwd: t.root,
      encoding: 'utf8',
      env: { ...process.env, FS_SPY_OUT: out, FS_SPY_UNDER: t.root },
    });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const verdict = JSON.parse(readFileSync(out, 'utf8'));
    const scanned = verdict.uses.filter((p) => p.includes('/apps/'));
    assert.ok(scanned.length >= 20, `COVERAGE LOST — the spy saw ${scanned.length} scanned file(s) under apps/`);
    // sameFunction: the #83 shape is the scan's OWN look then read. Other limbs of this guard
    // read some of the same files by path after the scan has opened them; those pairs are
    // not one decision acted on twice, so they are excluded here.
    const racy = verdict.flagged.filter((x) => x.path.includes('/apps/') && x.sameFunction);
    assert.deepEqual(racy.slice(0, 5), [], `${racy.length} scanned file(s) were looked at, then read by path`);
  });

  test('a faithful backend stamp passes, including its derived ALLOWED_ORIGINS', () => {
    const r = run(tree({ app: 'probeapi', backend: true }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ALLOWED_ORIGINS derived to https:\/\/nikatru\.com/);
  });

  // ── 1 · the escaping defect, one destination at a time ────────────────────
  test('an HTML-escaped appName fails (the Dart const)', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            `apps/${app}/lib/core/app_config.dart`,
            configDart({
              app,
              name: 'Probe&#x27;s &amp; Co — 24&#x2F;7 Smoke',
              base: 'https://platform.nikatru.com/v1',
            }),
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
  // 🔴 THE DEFECT THIS LIMB EXISTS FOR, AND IT SHIPPED IN THE TEMPLATE FROM THE DAY
  // THE BRICK WAS WRITTEN UNTIL 2026-09-12. `--dart-define-from-file` maps each JSON
  // key to a define of EXACTLY that name, so a file of wire-style snake keys supplies
  // defines nothing reads and the app boots in DEMO MODE LOOKING CONFIGURED - no
  // error, no empty screen, just the wrong data. Measured 2026-08-08 with a real
  // `flutter test --dart-define-from-file`: a snake file leaves API_BASE_URL unset.
  // Nothing could see it, because the guard and the template agreed on the wrong name.
  test('a defaults file of snake keys fails, naming every key the app never reads', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            `apps/${app}/config/defaults.json`,
            `{\n  "app_id": "${app}",\n  "api_base_url": "https://platform.nikatru.com/v1",\n  "environment": "dev"\n}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never reads: app_id, api_base_url, environment/);
    assert.match(r.out, /demo mode looking configured/);
    // and it still says what the right names ARE, so the reader is not left guessing
    assert.match(r.out, /API_BASE_URL/);
  });

  test('a "//" comment key is skipped by name, not by guesswork', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            `apps/${app}/config/defaults.json`,
            `{\n  "//": "how to run this",\n  "//keys": "why the keys look like this",\n  "API_BASE_URL": "https://platform.nikatru.com/v1"\n}\n`,
          ),
      }),
    );
    assert.equal(r.code, 0, r.out);
  });

  test('a bare "https://" in defaults.json fails — the blank var was interpolated', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(`apps/${app}/config/defaults.json`, `{\n  "API_BASE_URL": "https://"\n}\n`),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a scheme with no host/);
  });

  test('a bare "https://" in _phApiBase fails', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(`apps/${app}/lib/core/app_config.dart`, configDart({ app, name: NAME, base: 'https://' })),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /_phApiBase is "https:\/\/"/);
  });

  // 🔴 THE DEFECT THIS PINS, AND IT WOULD HAVE BROKEN APP #2 ON DAY ONE. The
  // template stamped `https://<app>.nikatru.com` into its own Worker's allowlist:
  // an address [ADR 075] retired and [ADR 080] section 4 stopped resolving, so the
  // Worker allowed exactly one origin THAT CANNOT EXIST and refused the apex the
  // app is actually served from. Every API call from its web build would have been
  // blocked by the browser, with no server-side error to find. The guard agreed
  // with the template, which is why nothing caught it.
  test('the retired per-app subdomain in ALLOWED_ORIGINS fails, naming the apex', () => {
    const r = run(
      tree({
        app: 'probeapi',
        backend: true,
        mutate: ({ write, app }) =>
          write(
            `services/${app}-api/wrangler.jsonc`,
            `{\n  "name": "${app}-api",\n  "vars": { "ALLOWED_ORIGINS": "https://${app}.nikatru.com" }\n}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ALLOWED_ORIGINS is "https:\/\/probeapi\.nikatru\.com"/);
    assert.match(r.out, /https:\/\/nikatru\.com/);
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
          write(`apps/${app}/config/defaults.json`, `{\n  "API_BASE_URL": "https://${app}-api.nikatru.com"\n}\n`),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /expected the derived "https:\/\/platform\.nikatru\.com\/v1"/);
  });

  // ── 3 · the release id defect ─────────────────────────────────────────────
  // THE DEFECT VERBATIM: `release: 'probe@0.1.0'` in the brick's main.dart. It
  // is right for at most one app, so it is checked from both ends — a foreign id
  // and a version that cannot move.
  test("a literal release naming ANOTHER app fails — this is the shipped defect", () => {
    const r = run(
      tree({
        app: 'probeapi',
        backend: true,
        mutate: ({ write, app }) => write(`apps/${app}/lib/main.dart`, mainDart("'probe@0.1.0'")),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /it names "probe", but this app is "probeapi"/);
  });

  test('a literal release with the RIGHT id but a frozen version still fails', () => {
    const r = run(
      tree({ mutate: ({ write, app }) => write(`apps/${app}/lib/main.dart`, mainDart("'probe@0.1.0'")) }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /version half "0\.1\.0" is a frozen literal/);
  });

  test('a release with no id half at all fails — fifty apps in one bucket', () => {
    const r = run(
      tree({ mutate: ({ write, app }) => write(`apps/${app}/lib/main.dart`, mainDart('AppConfig.appVersion')) }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `<app_id>@<version>` shape/);
  });

  test('a release the guard cannot resolve is reported, never shrugged past', () => {
    const r = run(
      tree({ mutate: ({ write, app }) => write(`apps/${app}/lib/main.dart`, mainDart('buildReleaseId()')) }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /could not be resolved/);
  });

  // The check is about the VALUE that reaches GlitchTip, not one spelling of the
  // expression that produces it — so an inline composition passes too.
  test('an inline `${AppConfig.appId}@${AppConfig.appVersion}` passes', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(`apps/${app}/lib/main.dart`, mainDart("'\${AppConfig.appId}@\${AppConfig.appVersion}'")),
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /telemetry release is this app's own identity \(probe@<APP_VERSION>\)/);
  });

  test('COVERAGE LOST when main.dart passes no readable release', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(`apps/${app}/lib/main.dart`, 'Future<void> main() async {\n  runApp(const App());\n}\n'),
      }),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /no `release:` to TelemetryConfig/);
  });

  test('COVERAGE LOST when main.dart is missing entirely', () => {
    const r = run(
      tree({ mutate: ({ root, app }) => rmSync(join(root, 'apps', app, 'lib', 'main.dart'), { force: true }) }),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /main\.dart is missing/);
  });

  // ── 4 · the catalogue short-name defect ───────────────────────────────────
  // THE DEFECT VERBATIM: "E-Book Reader" published as "E". Pinned with a name
  // that has NO subtitle separator at all, so the whole thing must survive.
  test('a catalogue name cut at an intra-word hyphen fails ("E-Book Reader…" → "E")', () => {
    const name = 'E-Book Reader & More';
    const r = run(
      tree({
        name,
        mutate: ({ write, app }) =>
          write(
            'catalog/apps.json',
            `${JSON.stringify([{ slug: app, name: 'E', url: `https://${app}.nikatru.com` }], null, 2)}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /publishes "E" but the app is called "E-Book Reader & More"/);
    assert.match(r.out, /cut mid-word at "-"/);
  });

  // …and the em-dash case still splits, which is what the hyphen fix must not
  // break. Both halves of the rule in one tree: a hyphen survives, a spaced
  // em dash does not.
  test('an em-dash subtitle is still dropped while the hyphen survives', () => {
    const r = run(tree({ name: 'E-Book Reader & More — Offline Library' }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /publishes "E-Book Reader & More"/);
  });

  test('a catalogue name that is not the display name at all fails', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            'catalog/apps.json',
            `${JSON.stringify([{ slug: app, name: 'Something Else' }], null, 2)}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /publishes "Something Else"/);
  });

  test('an empty catalogue name fails', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write('catalog/apps.json', `${JSON.stringify([{ slug: app, name: '' }], null, 2)}\n`),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /publishes an empty name/);
  });

  // The CI-ordering trap, made self-enforcing: the lane reverts apps.json to
  // keep the tree clean, and a guard run after that revert has checked nothing.
  test('COVERAGE LOST when the catalogue row is gone — the lane reverted it too early', () => {
    const r = run(
      tree({
        mutate: ({ write }) =>
          write('catalog/apps.json', `${JSON.stringify([{ slug: 'subscriptiontracker', name: 'Subly' }], null, 2)}\n`),
      }),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /check ci\.yml's step order/);
  });

  test('COVERAGE LOST when apps.json is missing altogether', () => {
    const r = run(
      tree({
        mutate: ({ root }) =>
          rmSync(join(root, 'catalog', 'apps.json'), { force: true }),
      }),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /apps\.json is missing/);
  });

  // ── the fixture audit: a probe that cannot trigger the checks is LOST ─────
  test('COVERAGE LOST when the probe name holds no hyphen inside a word', () => {
    const r = run(tree({ name: "Probe's & Co — 24/7 Smoke" }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /no hyphen inside a word/);
  });

  test('COVERAGE LOST when the probe display_name holds none of & < > " \' /', () => {
    const r = run(tree({ name: 'Probe Brick Smoke Test' }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /display_name/);
  });

  test('COVERAGE LOST when the probe description holds none of the escape set', () => {
    const r = run(tree({ desc: 'A plain smoke probe.' }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /description/);
  });

  test('COVERAGE LOST when the probe passes BOTH hosts explicitly — the derive path is never stamped', () => {
    const r = run(
      tree({
        app: 'probeapi',
        backend: true,
        vars: { subdomain: 'probeapi.nikatru.com', api_domain: 'probeapi-api.nikatru.com' },
      }),
    );
    assert.equal(r.code, 2, r.out);
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
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /text file\(s\) of the stamped tree/);
  });

  test('COVERAGE LOST when the app was never stamped at all', () => {
    const t = tree();
    rmSync(join(t.root, 'apps', t.app), { recursive: true, force: true });
    const r = run(t);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('a missing vars file is COVERAGE LOST, not a silent pass', () => {
    const t = tree();
    const r = spawnSync(process.execPath, [GUARD, '--vars', 'no_such_vars.json'], {
      cwd: t.root,
      encoding: 'utf8',
    });
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 · THE ICON LABEL IS A SECOND NAME, AND THE MANIFEST MUST CARRY *IT*
//
// `web/manifest.json`'s `short_name` used to be stamped from `display_name`, and
// this guard asserted the two were equal — an assertion true by construction,
// which is the same defect as no assertion at all. It is now stamped from
// `icon_label`, so the check can fail: a brick that reverted to the display name
// goes red below.
//
// The three COVERAGE LOST cases guard the guard. Each is a probe spec under
// which the check above could not fail no matter what the brick did, and each
// must refuse rather than print ok — the same rule the escape-set and
// blank-host fixture audits already hold.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-stamp-text-fidelity — the icon label', () => {
  test('a manifest short_name stamped from the DISPLAY name fails', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            `apps/${app}/web/manifest.json`,
            // JSON.stringify, never a hand-rolled `.replace(/"/g, …)` — that
            // escapes the quote and NOT the backslash, so a value ending in one
            // closes the string it was meant to stay inside. CodeQL
            // js/incomplete-sanitization flagged exactly that here.
            `{\n  "name": ${JSON.stringify(NAME)},\n  "short_name": ${JSON.stringify(NAME)},\n  "description": ${JSON.stringify(DESC)}\n}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /manifest\.json short_name is/);
  });

  test('a manifest short_name that is HTML-escaped fails on the icon-label path too', () => {
    const r = run(
      tree({
        mutate: ({ write, app }) =>
          write(
            `apps/${app}/web/manifest.json`,
            `{\n  "name": ${JSON.stringify(NAME)},\n  "short_name": "E-Book &amp; Co",\n  "description": ${JSON.stringify(DESC)}\n}\n`,
          ),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /short_name is "E-Book &amp; Co"/);
  });

  test('COVERAGE LOST when the probe declares no icon_label at all', () => {
    const r = run(tree({ vars: { icon_label: '' } }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /names no icon_label/);
  });

  test('COVERAGE LOST when icon_label EQUALS display_name — the check would be a tautology', () => {
    const r = run(tree({ icon: NAME }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /same string/);
  });

  test('COVERAGE LOST when icon_label holds none of & < > " \' /', () => {
    const r = run(tree({ icon: 'EBook Co' }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /icon_label \("EBook Co"\)/);
  });
});
