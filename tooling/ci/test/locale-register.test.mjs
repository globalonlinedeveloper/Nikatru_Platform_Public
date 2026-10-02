// ─────────────────────────────────────────────────────────────────────────────
// locale-register.test.mjs — tooling/ci/assert-locale-register.mjs and the
// register reader tooling/i18n/locales.mjs. Row O-LOCALES-HAND-TYPED-IN-12-PLACES.
//
// Every guard case runs on a COPY OF THE REAL FILES the guard reads (the
// register, its generated Dart twin, every ARB set, the app's native manifests
// and every named reader), so the green control is the real tree's verdict, and
// each red case breaks exactly one thing in that copy and requires the guard to
// name it.
//
// Run:  node --test tooling/ci/test/locale-register.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DART_REGISTER,
  LOCALES_CONFIG,
  READERS,
  handTypedLists,
  msixLanguages,
  plistLocalizations,
  renderDartRegister,
} from '../assert-locale-register.mjs';
import { REGISTER_REL, loadRegister, registerProblems, supportedCodes } from '../../i18n/locales.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-locale-register.mjs');
const APP = 'apps/subscriptiontracker';
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const CHASSIS = 'packages/design_system/lib/src/l10n';
const CODES = ['en', 'ta', 'hi'];

const arbs = (dir, prefix) =>
  readdirSync(join(REPO, dir))
    .filter((f) => f.startsWith(`${prefix}_`) && f.endsWith('.arb'))
    .map((f) => `${dir}/${f}`);

function filesToCopy() {
  return [
    REGISTER_REL,
    DART_REGISTER,
    `${APP}/pubspec.yaml`,
    `${APP}/ios/Runner/Info.plist`,
    `${APP}/macos/Runner/Info.plist`,
    `${APP}/android/app/src/main/AndroidManifest.xml`,
    `${APP}/${LOCALES_CONFIG}`,
    ...arbs(`${APP}/lib/l10n`, 'app'),
    ...arbs(CHASSIS, 'chassis'),
    ...arbs(`${BRICK}/lib/l10n`, 'app'),
    ...READERS.map((r) => r.file),
  ];
}

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nikatru-locale-register-'));
  for (const rel of new Set(filesToCopy())) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(root, rel));
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (...extra) => spawnSync(process.execPath, [GUARD, '--root', root, ...extra], { encoding: 'utf8' });
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const write = (rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const edit = (rel, from, to) => {
  const text = read(rel);
  assert.ok(text.includes(from), `${rel} no longer contains ${JSON.stringify(from)} — the case needs re-aiming`);
  write(rel, text.replace(from, to));
};
const registerJson = () => JSON.parse(read(REGISTER_REL));

describe('assert-locale-register — the real tree', () => {
  test('GREEN CONTROL: the real tree passes and names every limb', () => {
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    for (const limb of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) assert.match(r.stdout, new RegExp(`ok   ${limb} `));
  });

  test('GREEN CONTROL: the copy passes too, so every red case below breaks one thing', () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr + r.stdout);
  });

  test('the register the tree ships is en, ta, hi — and nothing else reads as supported', () => {
    assert.deepEqual(supportedCodes(loadRegister(REPO)), CODES);
  });
});

describe('L1 · the register', () => {
  test('an absent register is COVERAGE LOST, never a pass', () => {
    rmSync(join(root, REGISTER_REL));
    const r = run();
    assert.equal(r.status, 2, r.stderr + r.stdout);
    assert.match(r.stderr, /COVERAGE LOST — tooling\/i18n\/locales\.json is absent/);
  });

  test('a row missing its direction FAILS naming the row and field', () => {
    const reg = registerJson();
    delete reg.locales[1].direction;
    write(REGISTER_REL, JSON.stringify(reg));
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /locales\[1\] \(ta\): `direction` is missing/);
  });

  test('registerProblems refuses a duplicate code, a bad status and a source that is not supported', () => {
    const reg = JSON.parse(readFileSync(join(REPO, REGISTER_REL), 'utf8'));
    reg.locales.push({ ...reg.locales[1] });
    reg.locales[0].status = 'shipped';
    const p = registerProblems(reg);
    assert.ok(p.some((x) => /code "ta" is listed twice/.test(x)), p.join('\n'));
    assert.ok(p.some((x) => /status "shipped"/.test(x)), p.join('\n'));
    assert.ok(p.some((x) => /`source` \("en"\) must name a supported row/.test(x)), p.join('\n'));
  });
});

describe('L2 · generated files', () => {
  test('a register edit without regenerating FAILS on the Dart twin and locales_config', () => {
    const reg = registerJson();
    reg.locales[2].nativeName = 'हिंदी';
    write(REGISTER_REL, JSON.stringify(reg));
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L2 packages\/design_system\/lib\/src\/l10n\/locale_register\.g\.dart is not what the register renders/);
  });

  test('--write regenerates both, and the guard is green afterwards', () => {
    rmSync(join(root, DART_REGISTER));
    rmSync(join(root, APP, LOCALES_CONFIG));
    assert.equal(run().status, 1);
    const w = run('--write');
    assert.match(w.stdout, /wrote packages\/design_system\/lib\/src\/l10n\/locale_register\.g\.dart/);
    assert.equal(run().status, 0);
    assert.equal(read(DART_REGISTER), readFileSync(join(REPO, DART_REGISTER), 'utf8'));
  });

  test('the Dart twin carries every supported code, in register order, and both pseudo-locales', () => {
    const dart = renderDartRegister(loadRegister(REPO));
    assert.match(dart, /const List<String> kSupportedLocaleCodes = <String>\['en', 'ta', 'hi'\];/);
    assert.match(dart, /languageCode: 'en',\n    countryCode: 'XA'/);
    assert.match(dart, /languageCode: 'ar',\n    countryCode: 'XB',[\s\S]*?direction: TextDirection\.rtl/);
  });
});

describe('L3 · ARB sets', () => {
  test('RED CONTROL (item 2): the brick without app_hi.arb FAILS — a stamped app would render English for Hindi', () => {
    rmSync(join(root, BRICK, 'lib/l10n/app_hi.arb'));
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L3 tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/lib\/l10n\/app_hi\.arb is missing/);
  });

  test('a chassis ARB for an unregistered language FAILS', () => {
    write(`${CHASSIS}/chassis_fr.arb`, '{ "@@locale": "fr" }\n');
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /chassis_fr\.arb ships a language the register does not list as supported/);
  });

  test('a PENDING row owes no ARB yet, and its ARB is refused until it is supported', () => {
    const reg = registerJson();
    reg.locales.push({ ...reg.locales[2], code: 'bn', name: 'Bengali', nativeName: 'বাংলা', script: 'Beng', status: 'pending', apple: 'bn', android: 'bn', msix: 'bn-in', play: 'bn-IN' });
    write(REGISTER_REL, JSON.stringify(reg));
    run('--write');
    assert.equal(run().status, 0, 'a pending row is registered, not shipped');
    write(`${CHASSIS}/chassis_bn.arb`, '{ "@@locale": "bn" }\n');
    assert.equal(run().status, 1);
  });
});

describe('L4 · native declarations', () => {
  test('an Info.plist without CFBundleLocalizations FAILS', () => {
    const rel = `${APP}/ios/Runner/Info.plist`;
    write(rel, read(rel).replace(/<key>CFBundleLocalizations<\/key>\s*<array>[\s\S]*?<\/array>/, ''));
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L4 apps\/subscriptiontracker\/ios\/Runner\/Info\.plist has no CFBundleLocalizations/);
  });

  test('a macOS Info.plist one language short FAILS naming both lists', () => {
    edit(`${APP}/macos/Runner/Info.plist`, '\t\t<string>hi</string>\n', '');
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /CFBundleLocalizations is \[en, ta\], the register says \[en, ta, hi\]/);
  });

  test('an AndroidManifest without android:localeConfig FAILS', () => {
    edit(`${APP}/android/app/src/main/AndroidManifest.xml`, '        android:localeConfig="@xml/locales_config"\n', '');
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /has no android:localeConfig="@xml\/locales_config"/);
  });

  test('RED CONTROL: MSIX back to en-us alone FAILS', () => {
    edit(`${APP}/pubspec.yaml`, 'languages: en-us,ta-in,hi-in', 'languages: en-us');
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /msix_config languages is "en-us", the register says "en-us,ta-in,hi-in"/);
  });

  test('the readers parse what the manifests write', () => {
    assert.deepEqual(plistLocalizations('<key>CFBundleLocalizations</key>\n<array>\n <string>en</string>\n <string>ta</string>\n</array>'), ['en', 'ta']);
    assert.equal(plistLocalizations('<key>CFBundleName</key>'), null);
    assert.deepEqual(msixLanguages('name: x\nmsix_config:\n  store: true\n  languages: en-us, ta-in # two\n  arch: x64\nflutter:\n  languages: zz\n'), ['en-us', 'ta-in']);
    assert.equal(msixLanguages('name: x\n'), null);
  });
});

describe('L5 · named readers', () => {
  test('RED CONTROL: the chassis picker back on a typed list FAILS twice — L5 and L6', () => {
    const rel = 'packages/chassis_screens/lib/settings/settings_screen.dart';
    edit(rel, 'for (final RegisteredLocale row in kSupportedLocales)', "for (final String c in <String>['en', 'ta'])");
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L5 packages\/chassis_screens\/lib\/settings\/settings_screen\.dart no longer reads the register/);
    assert.match(r.stderr, /L6 packages\/chassis_screens\/lib\/settings\/settings_screen\.dart:\d+ types the locale list \[en, ta\] by hand/);
  });

  test('the notice limb reading the brick again FAILS', () => {
    edit('tooling/ci/assert-policy-archive.mjs', "from '../i18n/locales.mjs'", "from './locales-elsewhere.mjs'");
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L5 tooling\/ci\/assert-policy-archive\.mjs no longer reads the register/);
  });

  test('a scan that no longer reaches a named reader is COVERAGE LOST', () => {
    rmSync(join(root, 'tooling/release/submit-play.mjs'));
    const r = run();
    // L5 records the missing file first; the scan's reach check then refuses outright.
    assert.equal(r.status, 2, r.stderr + r.stdout);
    assert.match(r.stderr, /did not reach tooling\/release\/submit-play\.mjs/);
  });
});

describe('L6 · hand-typed lists', () => {
  test('RED CONTROL: a Dart test looping over a typed list FAILS with file and line', () => {
    write(`${APP}/test/typed_test.dart`, "void main() {\n  for (final String code in <String>['en', 'ta']) {\n    print(code);\n  }\n}\n");
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L6 apps\/subscriptiontracker\/test\/typed_test\.dart:2 types the locale list \[en, ta\]/);
  });

  test('a Node constant FAILS; a Locale list FAILS; a yml file list FAILS', () => {
    const js = handTypedLists("export const LOCALES = Object.freeze(['en', 'ta']);\n", 'x.mjs', CODES);
    assert.deepEqual(js.map((h) => h.codes), [['en', 'ta']]);
    const dart = handTypedLists("const l = <Locale>[Locale('en'), Locale('hi')];\n", 'x.dart', CODES);
    assert.deepEqual(dart.map((h) => h.codes), [['en', 'hi']]);
    const yml = handTypedLists('run: |\n  sha256sum a/chassis_localizations_en.dart \\\n    a/chassis_localizations_ta.dart\n', 'ci.yml', CODES);
    assert.deepEqual(yml.map((h) => h.codes), [['en', 'ta']]);
    const json = handTypedLists('{ "locales": ["en", "ta", "hi"] }\n', 'm.json', CODES);
    assert.deepEqual(json.map((h) => h.codes), [['en', 'ta', 'hi']]);
  });

  test('NOT a list: prose in a comment, a per-locale map, two separate calls, JSON prose', () => {
    assert.deepEqual(handTypedLists("// compares ['en', 'ta'] by hand\nconst x = 1;\n", 'x.dart', CODES), []);
    assert.deepEqual(handTypedLists("/* ['en', 'ta'] */\n", 'x.mjs', CODES), []);
    assert.deepEqual(handTypedLists("const word = <String, String>{\n  'en': 'Settings',\n  'ta': 'அமைப்புகள',\n};\n", 'x.dart', CODES), []);
    assert.deepEqual(handTypedLists("final en = load('en');\nfinal ta = load('ta');\n", 'x.dart', CODES), []);
    assert.deepEqual(handTypedLists('{ "why": "the `en`/`ta` tiles and \'en\', \'ta\'" }\n', 'x.json', CODES), []);
    assert.deepEqual(handTypedLists("# en and ta: chassis_localizations_en.dart chassis_localizations_ta.dart\nrun: x\n", 'ci.yml', CODES), []);
  });

  test('a URL in a string does not hide the list after it on the same line', () => {
    const hits = handTypedLists("const u = 'https://x.test'; const l = ['en', 'hi'];\n", 'x.mjs', CODES);
    assert.deepEqual(hits.map((h) => h.codes), [['en', 'hi']]);
  });

  test('an exempt path (a guard-test fixture) is not scanned', () => {
    write('tooling/ci/test/some.test.mjs', "const locales = ['en', 'ta'];\n");
    assert.equal(run().status, 0);
  });
});

describe('tooling/i18n/locales.mjs CLI', () => {
  test('--codes prints the supported codes the CI regeneration step loops over', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'tooling/i18n/locales.mjs'), '--codes'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), CODES.join(' '));
    assert.ok(existsSync(join(REPO, REGISTER_REL)));
  });
});
