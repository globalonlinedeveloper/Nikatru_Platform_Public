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
  ltrOnlyCalls,
  msixLanguages,
  plistLocalizations,
  renderDartRegister,
} from '../assert-locale-register.mjs';
import { REGISTER_REL, loadRegister, registerProblems, supportedCodes } from '../../i18n/locales.mjs';
import { AUTH_MAIL_COPY_REL, authMailCopyProblems, readAuthMailCopy, renderAuthMail } from '../../i18n/auth-mail.mjs';
import { DIGEST_COPY } from '../assert-locale-register.mjs';

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
    AUTH_MAIL_COPY_REL,
    DIGEST_COPY,
    `${BRICK}/lib/app.dart`,
    'packages/design_system/lib/src/widgets/promo_card.dart',
    ...['confirm-signup.html', 'magic-link.html', 'reset-password.html'].flatMap((f) => [
      `docs/platform/supabase/email-templates/${f}`,
      `sites/nikatru/auth-mail/${f}`,
    ]),
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
    edit(rel, 'for (final RegisteredLocale r in kSupportedLocales)\n                              (r.code, r.nativeName),', "('en', 'English'),\n                            ('ta', 'தமிழ்'),");
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L5 packages\/chassis_screens\/lib\/settings\/settings_screen\.dart no longer reads the register/);
    assert.match(r.stderr, /L6 packages\/chassis_screens\/lib\/settings\/settings_screen\.dart:\d+(-\d+)? types the locale list \[en, ta\] by hand/);
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
    // L5 records the missing file as a FINDING (exit 1), and the reach check's
    // could-not-look is reported beside it rather than hiding it behind exit 2.
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L5 tooling\/release\/submit-play\.mjs is missing/);
    assert.match(r.stderr, /\(and COVERAGE LOST — the hand-typed-list scan did not reach tooling\/release\/submit-play\.mjs/);
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

describe('L7 · server-side copy, and the auth e-mails it renders', () => {
  test('RED CONTROL (item 5): the digest copy without its hi block FAILS', () => {
    const d = JSON.parse(read(DIGEST_COPY));
    delete d.hi;
    write(DIGEST_COPY, JSON.stringify(d));
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L7 services\/platform\/src\/lib\/digest-copy\.json has no "hi" block/);
  });

  test('a digest block one key short FAILS naming the key', () => {
    const d = JSON.parse(read(DIGEST_COPY));
    delete d.ta.unnamed;
    write(DIGEST_COPY, JSON.stringify(d));
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /"ta" lacks unnamed/);
  });

  test('RED CONTROL: an auth mail whose ta button was dropped FAILS (L7), and its template is not rendered', () => {
    const c = JSON.parse(read(AUTH_MAIL_COPY_REL));
    delete c.templates['magic-link.html'].ta.button;
    write(AUTH_MAIL_COPY_REL, JSON.stringify(c));
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L7 tooling\/i18n\/auth-mail-copy\.json templates\["magic-link\.html"\]\.ta: `button` is missing/);
  });

  test('a hand-edited served template FAILS on L2', () => {
    edit('sites/nikatru/auth-mail/reset-password.html', 'Reset your password', 'Reset it');
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /L2 sites\/nikatru\/auth-mail\/reset-password\.html is not what the register renders/);
  });

  test('the rendered template branches on the metadata locale SAFELY, with English last', () => {
    const reg = loadRegister(REPO);
    const html = renderAuthMail(reg, readAuthMailCopy(REPO)).get('confirm-signup.html');
    // A bare field access on a nil .Data is a Go template ERROR, i.e. no mail at all:
    // the value is only ever read through `with`, and stringified before `eq`.
    assert.match(html, /\{\{- \$locale := "" \}\}\{\{ with \.Data \}\}\{\{ with \.locale \}\}\{\{ \$locale = printf "%v" \. \}\}/);
    assert.doesNotMatch(html.split('\n').slice(5).join('\n'), /\.Data\./);
    const branches = [...html.matchAll(/\{\{- (if|else if) eq \$locale "(\w+)" \}\}/g)].map((m) => m[2]);
    assert.deepEqual(branches, supportedCodes(reg).filter((c) => c !== reg.source));
    assert.ok(html.indexOf('{{- else }}') > html.lastIndexOf('else if'));
    assert.match(html.slice(html.indexOf('{{- else }}')), /Welcome to Nikatru\. Tap the button below to\n {12}confirm <strong>\{\{ \.Email \}\}<\/strong> and activate your account\./);
    assert.equal((html.match(/\{\{ \.ConfirmationURL \}\}/g) ?? []).length, 1 + 3 * supportedCodes(reg).length);
  });

  test('authMailCopyProblems: a block for an unregistered language and an intro without {email}', () => {
    const reg = loadRegister(REPO);
    const c = readAuthMailCopy(REPO);
    c.templates['magic-link.html'].fr = c.templates['magic-link.html'].en;
    c.templates['magic-link.html'].hi = { ...c.templates['magic-link.html'].hi, intro: ['a', 'b'] };
    const p = authMailCopyProblems(reg, c);
    assert.ok(p.some((x) => /has a block for fr/.test(x)), p.join('\n'));
    assert.ok(p.some((x) => /hi: `intro` never says \{email\}/.test(x)), p.join('\n'));
  });
});

describe('L8 · right-to-left readiness', () => {
  test('RED CONTROL (item 4): promo_card back on fromLTRB(16, 12, 8, 12) FAILS with file and line', () => {
    edit('packages/design_system/lib/src/widgets/promo_card.dart', 'EdgeInsetsDirectional.fromSTEB(16, 12, 8, 12)', 'EdgeInsets.fromLTRB(16, 12, 8, 12)');
    const r = run();
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /L8 packages\/design_system\/lib\/src\/widgets\/promo_card\.dart:\d+ EdgeInsets\.fromLTRB\(16, …, 8, …\) — use EdgeInsetsDirectional\.fromSTEB/);
  });

  test('every LTR-only form is found, with its directional twin named', () => {
    const src = [
      "const a = EdgeInsets.only(right: 8);",
      "const b = EdgeInsets.fromLTRB(\n  16,\n  8,\n  8,\n  8,\n);",
      "final c = Positioned(bottom: -2, right: -2, child: x);",
      "final d = Align(alignment: on ? Alignment.centerRight : Alignment.centerLeft);",
      "final e = Text('x', textAlign: TextAlign.left);",
    ].join('\n');
    assert.deepEqual(
      ltrOnlyCalls(src).map((h) => `${h.line} ${h.what.split(' — ')[0]}`),
      ['1 EdgeInsets.only(left:/right:)', '2 EdgeInsets.fromLTRB(16, …, 8, …)', '8 Positioned(left:/right:)', '9 Alignment.centerRight', '9 Alignment.centerLeft', '10 TextAlign.left'],
    );
  });

  test('direction-NEUTRAL forms pass: symmetric insets, both-sides pins, gradients, comments', () => {
    const src = [
      'const a = EdgeInsets.fromLTRB(16, 0, 16, 20);',
      'const b = EdgeInsets.only(left: 4, right: 4, top: 2);',
      'final c = Positioned(left: 0, right: 0, bottom: 0, child: x);',
      'const g = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight);',
      '// was EdgeInsets.only(right: 8) before RTL',
      'const d = EdgeInsetsDirectional.only(end: 8);',
      'const e = EdgeInsets.only(top: 8);',
    ].join('\n');
    assert.deepEqual(ltrOnlyCalls(src), []);
  });

  test('a UI tree the scan cannot reach is COVERAGE LOST', () => {
    // The brick's only Dart file in the copy goes; its ARB files stay, so there
    // is no finding — only a tree L8 can no longer see.
    rmSync(join(root, BRICK, 'lib/app.dart'));
    const r = run();
    assert.equal(r.status, 2, r.stderr + r.stdout);
    assert.match(r.stderr, /COVERAGE LOST — the right-to-left scan read no Dart file under tooling\/bricks/);
  });
});
