// ─────────────────────────────────────────────────────────────────────────────
// propagate-versions.test.mjs — the propagator must be able to REFUSE, and must
// leave the tree untouched when it does.
//
// tooling/scripts/propagate-versions.mjs WRITES build inputs. That is a
// different risk from a guard, which can only ever fail a build: a propagator
// that is wrong writes a wrong version into a workflow and the wrong version is
// then what CI installs. So the cases below are weighted towards the two
// outcomes that would not be noticed — a refusal that quietly wrote half the
// sites anyway, and a rewrite that landed inside a comment.
//
// Every case runs the script as a real subprocess against a temp fixture, the
// way CI would, and every REFUSAL case asserts the fixture is byte-identical
// afterwards. `assert.equal(after, before)` is the load-bearing line in this
// file; the exit code alone would pass on a script that refused loudly and
// wrote anyway.
//
// Pipeline requirement: Private/requirements/ → F-2.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"   (glob, so every *.test.mjs runs;
//       a bare directory path is treated as a module on Windows and throws)
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', '..', 'scripts', 'propagate-versions.mjs');
const GUARD = resolve(HERE, '..', 'assert-version-consistency.mjs');

let ROOT;
before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-propagate-'));
});
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** The declaration every fixture starts from — the same shape the real
 *  tooling/versions.json has, trimmed to the keys the rules read. */
const DECL = {
  flutter: '3.44.7',
  node: '24',
  java: '17',
  melos: '8.2.2',
  mason_cli: '0.1.3',
  wrangler: '4.114.0',
  gitleaks: '8.30.1',
  runner_ubuntu: 'ubuntu-24.04',
  runner_windows: 'windows-2025',
  runner_macos: 'macos-26',
  dart_language: '3.9.0',
};

// The five targets assert-version-consistency.mjs REFUSES to run without. They
// are required rather than existsSync-gated so that hiding one cannot shrink the
// scan while it still prints ok (measured 2026-08-17 at 85 references across 14
// files with the Android module moved aside). collectTargets is imported, so the
// propagator inherits that refusal — and one case below proves it.
const BRICK = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/package.json';
const ANDROID = 'apps/demo/android/app/build.gradle.kts';
const SCAN_SECRETS = 'tooling/ci/scan-secrets.mjs';
// The wrangler island (EXT-3, 2026-09-24): a REQUIRED target of collectTargets, like the brick.
const WRANGLER_ISLAND = 'tooling/wrangler/package.json';
// The pubspecs the two floor rules read (O-PUBSPEC-FLOORS-UNTIED-TO-THE-PIN): the
// members the root's `workspace:` list names, and the brick's app template and hooks.
const CORE = 'packages/core/pubspec.yaml';
const APP = 'apps/demo/pubspec.yaml';
const TEMPLATE = 'tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml';
const HOOKS = 'tooling/bricks/app/hooks/pubspec.yaml';

const workflow = ({ flutter = DECL.flutter, node = DECL.node, melos = DECL.melos, java = DECL.java } = {}) =>
  `name: X\njobs:\n  j:\n    steps:\n` +
  Array.from({ length: 5 }, () => `      - uses: x\n        with:\n          flutter-version: ${flutter}\n`).join('') +
  Array.from({ length: 5 }, () => `      - uses: y\n        with:\n          node-version: ${node}\n`).join('') +
  `      - uses: z\n        with:\n          java-version: ${java}\n` +
  `      - run: dart pub global activate melos ${melos}\n` +
  `      - run: dart pub global activate mason_cli ${DECL.mason_cli}\n`;

/** The workspace root manifest. Its comment names a call site WITHOUT a version,
 *  the way the real one does since 2026-09-25: the guard names any comment that
 *  quotes a melos version other than the pin, and the propagator never rewrites
 *  one. The case that proves both carries its own versioned comment. */
const rootManifest = (melos = DECL.melos) =>
  `name: ws\nenvironment:\n  sdk: ^${DECL.dart_language}\n\nworkspace:\n  - packages/core\n  - apps/demo\n\n` +
  '# .github/workflows/ci.yml activates melos at the pin before the gate\n' +
  `dev_dependencies:\n  melos: ${melos}\n`;

const dartPubspec = (name, sdk = `^${DECL.dart_language}`) => `name: ${name}\nenvironment:\n  sdk: ${sdk}\n`;
const flutterPubspec = (name, sdk = `^${DECL.dart_language}`) =>
  `name: ${name}\nenvironment:\n  sdk: ${sdk}\n  flutter: ">=${DECL.flutter}"\n\ndependencies:\n  flutter:\n    sdk: flutter\n`;

const readmeDoc = (melos = DECL.melos) =>
  `# ws\n\n## Building it\n\n\`\`\`bash\ndart pub global activate melos ${melos}\nflutter pub get\n\`\`\`\n`;

const androidModule = (java = DECL.java) =>
  `android {\n` +
  `    compileOptions {\n` +
  `        sourceCompatibility = JavaVersion.VERSION_${java}\n` +
  `        targetCompatibility = JavaVersion.VERSION_${java}\n` +
  `    }\n` +
  `    kotlin {\n` +
  `        compilerOptions {\n` +
  `            jvmTarget = JvmTarget.JVM_${java}\n` +
  `        }\n` +
  `    }\n` +
  `}\n`;

const scanSecrets = (ver = DECL.gitleaks) =>
  `// the volume parser's dated re-measurement\nconst VALIDATED_AGAINST = '${ver}';\nexport default VALIDATED_AGAINST;\n`;

/** Build a throwaway tree. `decl` overrides tooling/versions.json only — the
 *  call sites always start at DECL, which is what makes a bumped declaration a
 *  drift the propagator has to resolve. */
function build(name, { decl = {}, omit = [], workflowOpts = {}, bodies = {} } = {}) {
  const dir = join(ROOT, name);
  const files = {
    'tooling/versions.json': `${JSON.stringify({ ...DECL, ...decl }, null, 2)}\n`,
    '.github/workflows/ci.yml': workflow(workflowOpts),
    'pubspec.yaml': rootManifest(),
    'README.md': readmeDoc(),
    [SCAN_SECRETS]: scanSecrets(),
    [ANDROID]: androidModule(),
    [BRICK]: JSON.stringify({ devDependencies: { wrangler: DECL.wrangler } }),
    [WRANGLER_ISLAND]: JSON.stringify({ devDependencies: { wrangler: DECL.wrangler } }),
    [CORE]: dartPubspec('core'),
    [APP]: flutterPubspec('demo'),
    [TEMPLATE]: flutterPubspec('{{app_id}}'),
    [HOOKS]: dartPubspec('app_hooks'),
    ...bodies,
  };
  for (const [rel, body] of Object.entries(files)) {
    if (omit.includes(rel)) continue;
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Every file in the fixture, as one comparable string. This is what makes a
 *  "refused" case mean "wrote nothing" rather than "printed something". */
function snapshot(dir) {
  const rels = [
    'tooling/versions.json',
    '.github/workflows/ci.yml',
    'pubspec.yaml',
    'README.md',
    SCAN_SECRETS,
    ANDROID,
    BRICK,
    WRANGLER_ISLAND,
    CORE,
    APP,
    TEMPLATE,
    HOOKS,
  ];
  return rels
    .filter((r) => existsSync(join(dir, r)))
    .map((r) => `${r}\n${readFileSync(join(dir, r), 'utf8')}`)
    .join('\n=====\n');
}

function propagate(dir, extra = []) {
  const r = spawnSync(process.execPath, [SCRIPT, dir, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function guard(dir) {
  const r = spawnSync(process.execPath, [GUARD, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('propagate-versions', () => {
  // ── (a) the green control ──────────────────────────────────────────────────
  // A propagator with no case for "already correct" is a propagator whose every
  // other case is untrustworthy: it would look identical to one that rewrites
  // the tree on every run.
  test('a tree already in sync exits 0, reports nothing to write, and changes nothing', () => {
    const dir = build('pv-in-sync');
    const before = snapshot(dir);
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 0);
    assert.match(out, /already match tooling\/versions\.json/);
    assert.equal(snapshot(dir), before);
    assert.equal(guard(dir).code, 0);
  });

  // ── (b) the instance this was written for ──────────────────────────────────
  test('DRY RUN is the default — it names the sites and writes nothing', () => {
    const dir = build('pv-melos-dry', { decl: { melos: '8.6.0' } });
    const before = snapshot(dir);
    const { code, out } = propagate(dir);
    assert.equal(code, 0);
    assert.match(out, /DRY RUN — 3 site\(s\) would move/);
    assert.match(out, /ci\.yml:\d+ +Melos +8\.2\.2 -> 8\.6\.0/);
    assert.match(out, /pubspec\.yaml:\d+ +Melos \(workspace dev_dependency\) +8\.2\.2 -> 8\.6\.0/);
    assert.match(out, /README\.md:\d+ +Melos +8\.2\.2 -> 8\.6\.0/);
    assert.equal(snapshot(dir), before, 'a dry run must not touch the tree');
  });

  test('--write moves the three melos sites and the drift guard then passes', () => {
    const dir = build('pv-melos-write', { decl: { melos: '8.6.0' } });
    assert.equal(guard(dir).code, 1, 'the fixture must start RED or the case proves nothing');
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 0);
    assert.match(out, /wrote 3 site\(s\) across 3 file\(s\)/);
    assert.match(readFileSync(join(dir, '.github/workflows/ci.yml'), 'utf8'), /activate melos 8\.6\.0/);
    assert.match(readFileSync(join(dir, 'pubspec.yaml'), 'utf8'), /^ {2}melos: 8\.6\.0$/m);
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /activate melos 8\.6\.0/);
    assert.equal(guard(dir).code, 0);
  });

  // 🔴 THE COMMENT CASE. The guard strips comments before it compares so that a
  // commented-out version cannot mask a drift; the propagator imports that same
  // strip so that a commented-out version cannot be REWRITTEN. Without it the
  // pubspec.yaml block that enumerates the six melos call sites in `#` prose
  // would be edited on every bump, and the enumeration is a record of what was
  // measured on a date — a frozen record, not a call site.
  // Since 2026-09-25 the guard also READS the root pubspec's comments and names a
  // melos version in one that is not the pin — so the sentence the propagator
  // leaves alone is then the one thing the guard reports.
  test('a version quoted inside a `#` comment is left alone, and the guard then names that comment', () => {
    const dir = build('pv-comment', {
      decl: { melos: '8.6.0' },
      bodies: {
        'pubspec.yaml': rootManifest().replace(
          '\ndev_dependencies:\n',
          `\n# 2. .github/workflows/ci.yml   \`dart pub global activate melos ${DECL.melos}\` — the CI runner\ndev_dependencies:\n`,
        ),
      },
    });
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 0, out);
    const manifest = readFileSync(join(dir, 'pubspec.yaml'), 'utf8');
    assert.match(manifest, /# 2\. \.github\/workflows\/ci\.yml.*activate melos 8\.2\.2/);
    assert.match(manifest, /^ {2}melos: 8\.6\.0$/m);
    const g = guard(dir);
    assert.equal(g.code, 1, g.out);
    assert.match(g.out, /pubspec\.yaml:10 a comment quotes melos "8\.2\.2" but versions\.json declares "8\.6\.0"/);
    assert.match(g.out, /1 version drift problem\(s\)/, 'every call site moved; the comment is all that is left');
  });

  // ── (c) the floor class ────────────────────────────────────────────────────
  // renovate.json disables minor/patch/pin/digest for the java-version and
  // node-version datasources because five of java's eight sites are enum
  // constants, an apt package name and a JVM directory. PR #316 is what a
  // proposal those five cannot accept looks like: red forever, closable only by
  // hand. This is that PR, reproduced offline.
  test('a floor-class key bumped to a PATCH is refused, by name, with nothing written', () => {
    const dir = build('pv-java-patch', { decl: { java: '17.0.20+8' } });
    const before = snapshot(dir);
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 2);
    assert.equal(snapshot(dir), before, 'a refusal must write NOTHING, not even the expressible sites');
    assert.match(out, /CANNOT EXPRESS "17\.0\.20\+8"/);
    assert.match(out, /Java \(Gradle compileOptions\)/);
    assert.match(out, /Java \(Kotlin jvmTarget\)/);
    assert.match(out, /HAND DECISION/);
    // and it says what it deliberately did NOT do, rather than staying quiet
    // about the sites that could have moved
    assert.match(out, /COULD have moved and deliberately did not/);
    assert.match(out, /java-version/);
  });

  test('the refusal is about EXPRESSIBILITY, not about the key — java 17 -> 21 propagates', () => {
    const dir = build('pv-java-major', { decl: { java: '21' } });
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 0);
    assert.match(out, /Java \(Gradle compileOptions\) +17 -> 21/);
    assert.match(readFileSync(join(dir, ANDROID), 'utf8'), /JavaVersion\.VERSION_21/);
    assert.match(readFileSync(join(dir, ANDROID), 'utf8'), /JvmTarget\.JVM_21/);
    assert.equal(guard(dir).code, 0);
  });

  // ── (d) a rule reading a key the declaration does not have ─────────────────
  test('a rule whose versions.json key is missing is refused, never written as "undefined"', () => {
    const dir = build('pv-unknown-key');
    const decl = JSON.parse(readFileSync(join(dir, 'tooling/versions.json'), 'utf8'));
    delete decl.melos;
    decl.melos_cli = '8.2.2';
    writeFileSync(join(dir, 'tooling/versions.json'), `${JSON.stringify(decl, null, 2)}\n`);
    const before = snapshot(dir);
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 2);
    assert.equal(snapshot(dir), before);
    assert.match(out, /key `melos`, which that file does not declare/);
    assert.match(out, /would write "undefined" into a build input/);
    // the java/node floor paragraph explains a DIFFERENT cause and must not be
    // printed here — a message that names the wrong reason stops being read
    assert.doesNotMatch(out, /HAND DECISION/);
  });

  // ── the hand-only site ─────────────────────────────────────────────────────
  // scan-secrets.mjs's VALIDATED_AGAINST could syntactically hold the new
  // gitleaks version. It still must not be written by a script, because the
  // constant is the release the `scanned ~N bytes` parser was MEASURED against
  // and it moves together with the captured canary lines beside it.
  test('the gitleaks parser constant is refused BY NAME even though the syntax would take it', () => {
    const dir = build('pv-gitleaks', { decl: { gitleaks: '8.31.0' } });
    const before = snapshot(dir);
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 2);
    assert.equal(snapshot(dir), before);
    assert.match(out, /MOVES BY HAND/);
    assert.match(out, /VALIDATED_AGAINST/);
    assert.doesNotMatch(out, /HAND DECISION/, 'this is not the java/node floor class and must not claim to be');
  });

  // ── the coverage limbs ─────────────────────────────────────────────────────
  test('COVERAGE LOST from the shared target list stops the propagator too', () => {
    const dir = build('pv-no-readme', { decl: { melos: '8.6.0' }, omit: ['README.md'] });
    const before = snapshot(dir);
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 2, 'collectTargets refuses with the guard’s own exit code and wording');
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /README\.md/);
    assert.equal(snapshot(dir), before);
  });

  test('a scan that matches NOTHING is refused, not reported in sync', () => {
    const dir = build('pv-silent');
    // Empty every call site while leaving every required target present: the
    // tree now "agrees" with versions.json only because nothing was compared.
    // The `workspace:` list stays: without it collectTargets refuses first, and
    // this case would prove that refusal instead of the empty scan.
    writeFileSync(join(dir, '.github/workflows/ci.yml'), 'name: X\njobs: {}\n');
    writeFileSync(join(dir, 'pubspec.yaml'), 'name: ws\nworkspace:\n  - packages/core\n  - apps/demo\n');
    writeFileSync(join(dir, 'README.md'), '# ws\n');
    writeFileSync(join(dir, SCAN_SECRETS), '// nothing here\n');
    writeFileSync(join(dir, ANDROID), 'android {\n}\n');
    writeFileSync(join(dir, BRICK), '{}\n');
    writeFileSync(join(dir, WRANGLER_ISLAND), '{}\n');
    writeFileSync(join(dir, CORE), 'name: core\n');
    writeFileSync(join(dir, APP), 'name: demo\n');
    writeFileSync(join(dir, TEMPLATE), 'name: app\n');
    writeFileSync(join(dir, HOOKS), 'name: app_hooks\n');
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 2);
    assert.match(out, /matched 0 version reference\(s\)/);
    assert.match(out, /The scan is broken, not the tree/);
  });

  test('a tree with no tooling/versions.json is refused, not treated as empty', () => {
    const dir = build('pv-no-decl', { omit: ['tooling/versions.json'] });
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 2);
    assert.match(out, /no tooling\/versions\.json/);
  });

  // ── the two pubspec floors (O-PUBSPEC-FLOORS-UNTIED-TO-THE-PIN) ────────────
  test('the range the tree carried is written as the caret the declaration spells, and the guard then passes', () => {
    // The real tree on 2026-09-25: every member and the brick hooks at
    // `sdk: ">=3.5.0 <4.0.0"`. The rule captures the whole constraint and spells
    // `dart_language` 3.9.0 as `^3.9.0`, so the quotes and the upper bound go too.
    const dir = build('pv-sdk-range', {
      bodies: { [CORE]: dartPubspec('core', '">=3.5.0 <4.0.0"'), [HOOKS]: dartPubspec('app_hooks', '">=3.5.0 <4.0.0"') },
    });
    assert.equal(guard(dir).code, 1, 'the fixture must start RED or the case proves nothing');
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 0, out);
    assert.match(out, /packages\/core\/pubspec\.yaml:3 +Dart language floor \(pubspec environment sdk\) +">=3\.5\.0 <4\.0\.0" -> \^3\.9\.0/);
    assert.match(out, /wrote 2 site\(s\) across 2 file\(s\)/);
    assert.equal(readFileSync(join(dir, CORE), 'utf8'), 'name: core\nenvironment:\n  sdk: ^3.9.0\n');
    assert.equal(readFileSync(join(dir, HOOKS), 'utf8'), 'name: app_hooks\nenvironment:\n  sdk: ^3.9.0\n');
    assert.equal(guard(dir).code, 0);
  });

  test('a Flutter bump moves every Flutter floor with the workflow pins, keeping the quotes', () => {
    const dir = build('pv-flutter-floor', { decl: { flutter: '3.45.0' } });
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 0, out);
    // five workflow `flutter-version:` inputs, the member's floor and the template's
    assert.match(out, /wrote 7 site\(s\) across 3 file\(s\)/);
    assert.match(readFileSync(join(dir, APP), 'utf8'), /^ {2}flutter: ">=3\.45\.0"$/m);
    assert.match(readFileSync(join(dir, TEMPLATE), 'utf8'), /^ {2}flutter: ">=3\.45\.0"$/m);
    assert.equal(guard(dir).code, 0);
  });

  test('a workflow `sdk:` input is not a pubspec floor and is never rewritten', () => {
    const dir = build('pv-setup-dart', { bodies: { [CORE]: dartPubspec('core', '^3.0.0') } });
    const ci = join(dir, '.github/workflows/ci.yml');
    writeFileSync(ci, `${readFileSync(ci, 'utf8')}      - uses: dart-lang/setup-dart@v1\n        with:\n          sdk: 3.1.0\n`);
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 0, out);
    assert.match(out, /wrote 1 site\(s\) across 1 file\(s\)/);
    assert.match(readFileSync(ci, 'utf8'), /^ {10}sdk: 3\.1\.0$/m);
  });

  test('`dart_language` missing from the declaration is refused by key, with nothing written', () => {
    const dir = build('pv-no-dart-language');
    const decl = JSON.parse(readFileSync(join(dir, 'tooling/versions.json'), 'utf8'));
    delete decl.dart_language;
    writeFileSync(join(dir, 'tooling/versions.json'), `${JSON.stringify(decl, null, 2)}\n`);
    const before = snapshot(dir);
    const { code, out } = propagate(dir, ['--write']);
    assert.equal(code, 2);
    assert.equal(snapshot(dir), before);
    assert.match(out, /packages\/core\/pubspec\.yaml:3 Dart language floor \(pubspec environment sdk\) — the rule reads versions\.json key `dart_language`, which that file does not declare/);
  });
});
