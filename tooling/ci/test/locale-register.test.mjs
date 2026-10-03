// ─────────────────────────────────────────────────────────────────────────────
// locale-register.test.mjs — tooling/ci/assert-locale-register.mjs and the
// register renderer it grades (tooling/i18n/locales.mjs). Row
// O-LOCALES-HAND-TYPED-IN-12-PLACES.
//
// The green control is the REAL tree. Every red case runs on a git-initialised
// COPY of the real files the guard reads (the register, the generated table,
// every ARB root, the native manifests, the READERS) and breaks exactly one
// thing, then requires the guard to name it.
//
// Run:  node --test tooling/ci/test/locale-register.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check, findTypedLists, READERS, BRICK_APP, MIN_SCANNED } from '../assert-locale-register.mjs';
import {
  REGISTER, DART_TABLE, validateRegister, renderInfoPlist, renderManifest, renderMsixLanguages, supportedCodes, plan,
  renderChassisBridge,
} from '../../i18n/locales.mjs';
import { MESSAGES, SOURCE_DIR, TEMPLATES, renderTemplate, rows, localesWithCopy } from '../../i18n/auth-mail.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-locale-register.mjs');
const APP = 'apps/subscriptiontracker';
const realRegister = JSON.parse(readFileSync(join(REPO, REGISTER), 'utf8'));
const CODES = supportedCodes(realRegister);

function filesToCopy() {
  const set = new Set([REGISTER, DART_TABLE, MESSAGES, ...TEMPLATES.map((t) => `${SOURCE_DIR}/${t.file}`), ...READERS.map((r) => r.file)]);
  for (const it of plan(REPO)) set.add(it.path);
  for (const [dir, arbDir, prefix] of [
    [APP, 'lib/l10n', 'app'],
    ['packages/design_system', 'lib/src/l10n', 'chassis'],
    [BRICK_APP, 'lib/l10n', 'app'],
  ]) {
    set.add(`${dir}/l10n.yaml`);
    for (const c of CODES) set.add(`${dir}/${arbDir}/${prefix}_${c}.arb`);
  }
  return [...set];
}

let root;
function git(...args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'locale-register-'));
  for (const f of filesToCopy()) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    copyFileSync(join(REPO, f), join(root, f));
  }
  git('init', '-q');
  git('add', '-A');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const edit = (rel, fn) => writeFileSync(join(root, rel), fn(readFileSync(join(root, rel), 'utf8')));
const add = (rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
  git('add', '-A');
};
const verdict = () => check(root, { minScanned: 1 });
const has = (r, re) => r.findings.some((f) => re.test(f));

describe('assert-locale-register — the real tree', () => {
  test('green control: the real tree is clean, with coverage', () => {
    const r = check(REPO);
    assert.equal(r.coverage, null);
    assert.deepEqual(r.findings, []);
    assert.ok(r.ok.some((o) => /L4 \d+ tracked source file/.test(o)));
  });

  test('the CLI exits 0 on the real tree', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
  });

  test('green control: the fixture copy is clean too, so each red below is the one edit', () => {
    const r = verdict();
    assert.equal(r.coverage, null);
    assert.deepEqual(r.findings, []);
  });
});

describe('L1 register shape', () => {
  test('a row with no direction, a duplicate and a plural set without other are named', () => {
    const reg = structuredClone(realRegister);
    delete reg.locales[1].direction;
    reg.locales.push({ ...reg.locales[0] });
    reg.locales[2].plural = ['one'];
    const p = validateRegister(reg);
    assert.ok(p.some((x) => /has no "direction"/.test(x)));
    assert.ok(p.some((x) => /declared twice/.test(x)));
    assert.ok(p.some((x) => /include "other"/.test(x)));
  });

  test('a source locale that is not supported is refused', () => {
    const reg = structuredClone(realRegister);
    reg.locales.find((l) => l.code === reg.sourceLocale).status = 'pending';
    assert.ok(validateRegister(reg).some((x) => /sourceLocale/.test(x)));
  });

  test('a pseudo row with no valid direction is refused', () => {
    const reg = structuredClone(realRegister);
    reg.pseudo.push({ code: 'en-XA', direction: 'up' });
    assert.ok(validateRegister(reg).some((x) => /direction must be ltr or rtl/.test(x)));
  });

  test('an invalid register on disk is an L1 finding, not a crash', () => {
    edit(REGISTER, (s) => s.replace('"direction": "ltr"', '"direction": "sideways"'));
    assert.ok(has(verdict(), /^L1 .*sideways/));
  });
});

describe('L2 one ARB per supported locale, in every root', () => {
  test('the brick missing its Hindi ARB — the dead picker tile — is named', () => {
    rmSync(join(root, BRICK_APP, 'lib/l10n/app_hi.arb'));
    const r = verdict();
    assert.ok(has(r, /L2 tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/lib\/l10n\/app_hi\.arb is missing/), r.findings.join('\n'));
  });

  test('an ARB for a locale the register does not support is named', () => {
    add(`${APP}/lib/l10n/app_fr.arb`, '{ "@@locale": "fr" }\n');
    assert.ok(has(verdict(), /L2 apps\/subscriptiontracker\/lib\/l10n\/app_fr\.arb is a locale/));
  });

  test('a new SUPPORTED locale fails every root until its ARBs exist', () => {
    edit(REGISTER, (s) => {
      const reg = JSON.parse(s);
      reg.locales.push({ ...reg.locales[1], code: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', script: 'Beng', apple: 'bn', android: 'bn', msix: 'bn-in' });
      return JSON.stringify(reg, null, 2);
    });
    const r = verdict();
    for (const re of [/apps\/subscriptiontracker\/lib\/l10n\/app_bn\.arb is missing/, /chassis_bn\.arb is missing/, /\{\{app_id\}\}\/lib\/l10n\/app_bn\.arb is missing/]) {
      assert.ok(has(r, re), `${re}\n${r.findings.join('\n')}`);
    }
    // …and the generated table and every native manifest are stale (L3).
    assert.ok(has(r, /L3 packages\/design_system\/lib\/src\/l10n\/locale_register\.g\.dart is not what/));
    assert.ok(has(r, /L3 apps\/subscriptiontracker\/ios\/Runner\/Info\.plist/));
  });

  test('a PENDING locale owes nothing yet', () => {
    edit(REGISTER, (s) => {
      const reg = JSON.parse(s);
      reg.locales.push({ ...reg.locales[1], code: 'bn', status: 'pending', englishName: 'Bengali', nativeName: 'বাংলা', script: 'Beng', apple: 'bn', android: 'bn', msix: 'bn-in' });
      return JSON.stringify(reg, null, 2);
    });
    const r = verdict();
    assert.ok(!has(r, /^L2 /), r.findings.join('\n'));
  });

  test('fewer than three gen-l10n roots is COVERAGE LOST', () => {
    rmSync(join(root, BRICK_APP, 'l10n.yaml'));
    rmSync(join(root, APP, 'l10n.yaml'));
    assert.match(verdict().coverage ?? '', /L2 found 1 gen-l10n root/);
  });
});

describe('L3 generated table and native declarations', () => {
  test('a language dropped from CFBundleLocalizations is named', () => {
    edit(`${APP}/ios/Runner/Info.plist`, (s) => s.replace('\t\t<string>hi</string>\n', ''));
    assert.ok(has(verdict(), /L3 apps\/subscriptiontracker\/ios\/Runner\/Info\.plist is not what/));
  });

  test('the Android manifest losing android:localeConfig is named', () => {
    edit(`${APP}/android/app/src/main/AndroidManifest.xml`, (s) => s.replace(/\n\s*android:localeConfig="@xml\/locales_config"/, ''));
    assert.ok(has(verdict(), /L3 apps\/subscriptiontracker\/android\/app\/src\/main\/AndroidManifest\.xml/));
  });

  test('MSIX back to English only is named', () => {
    edit(`${APP}/pubspec.yaml`, (s) => s.replace(/^(\s*languages:).*$/m, '$1 en-us'));
    assert.ok(has(verdict(), /L3 apps\/subscriptiontracker\/pubspec\.yaml/));
  });

  test('a hand edit to the generated Dart table is named', () => {
    edit(DART_TABLE, (s) => s.replace("nativeName: 'हिन्दी'", "nativeName: 'Hindi'"));
    assert.ok(has(verdict(), /L3 packages\/design_system\/lib\/src\/l10n\/locale_register\.g\.dart/));
  });

  test('the renderers are idempotent and insert where Xcode and Gradle expect', () => {
    const plist = '<dict>\n\t<key>CFBundleDevelopmentRegion</key>\n\t<string>$(DEVELOPMENT_LANGUAGE)</string>\n</dict>\n';
    const once = renderInfoPlist(plist, ['en', 'ta']);
    assert.match(once, /<key>CFBundleLocalizations<\/key>\n\t<array>\n\t\t<string>en<\/string>\n\t\t<string>ta<\/string>\n\t<\/array>/);
    assert.equal(renderInfoPlist(once, ['en', 'ta']), once);
    assert.equal(renderInfoPlist('<dict/>', ['en']), null, 'no anchor is a finding, never a silent skip');
    const man = '<manifest>\n    <application\n        android:label="x">\n';
    const m1 = renderManifest(man);
    assert.match(m1, /<application\n {8}android:localeConfig="@xml\/locales_config"/);
    assert.equal(renderManifest(m1), m1);
    assert.equal(renderMsixLanguages('msix_config:\n  languages: en-us\n', ['en-us', 'ta-in']), 'msix_config:\n  languages: en-us, ta-in\n');
    assert.equal(renderMsixLanguages('msix_config:\n  store: true\n', ['en-us']), null);
  });
});

describe('L3 the auth-mail templates speak the register', () => {
  const msgs = JSON.parse(readFileSync(join(REPO, MESSAGES), 'utf8'));

  test('every supported translation with copy is a branch, English is the else', () => {
    const { branches, missing } = localesWithCopy(realRegister, msgs);
    assert.deepEqual(missing, []);
    assert.deepEqual(branches, CODES.filter((c) => c !== realRegister.sourceLocale));
    const html = readFileSync(join(REPO, SOURCE_DIR, 'magic-link.html'), 'utf8');
    for (const c of branches) assert.match(html, new RegExp(`eq \\$l "${c}"`));
    // English last, and its rows are exactly what the English strings render.
    const elseAt = html.indexOf('{{- else }}');
    assert.ok(elseAt > 0);
    assert.ok(html.slice(elseAt).includes(rows(msgs.authMail.en, 'magic-link')));
  });

  test('with no translations it renders the plain English template — no Go action added', () => {
    const t = renderTemplate(TEMPLATES[0], msgs, []);
    assert.doesNotMatch(t, /\$l|\.Data/);
    assert.match(t, /Confirm your email/);
  });

  test('a supported locale with no copy falls back to English and is reported', () => {
    const m = structuredClone(msgs);
    delete m.authMail.hi;
    const r = localesWithCopy(realRegister, m);
    assert.deepEqual(r.missing, ['hi']);
    assert.ok(!r.branches.includes('hi'));
  });

  test('a hand edit to a DR template is an L3 finding naming the fix', () => {
    edit(`${SOURCE_DIR}/reset-password.html`, (s) => s.replace('eq $l "hi"', 'eq $l "xx"'));
    const r = verdict();
    assert.ok(has(r, /L3 docs\/platform\/supabase\/email-templates\/reset-password\.html .*auth-mail\.mjs/), r.findings.join('\n'));
  });
});

describe('L4 no hand-typed locale list', () => {
  const codes = ['en', 'ta', 'hi'];
  test('the shapes the audit found are each caught', () => {
    for (const src of [
      "const List<String> kTranslations = <String>['ta', 'hi'];",
      'for (const arb of [\'app_en.arb\', \'app_ta.arb\']) {',
      "for (final Locale l in const <Locale>[Locale('en'), Locale('ta')]) {",
      'export const LOCALES = Object.freeze(["en", "ta"]);',
      'for f in chassis_localizations_en.dart chassis_localizations_ta.dart; do',
      "locales = [\n  'en',\n  'hi',\n]",
    ]) {
      assert.equal(findTypedLists(src, codes).length, 1, src);
    }
  });

  test('a single code, prose, and one code twice are not lists', () => {
    for (const src of [
      "locale: const Locale('ta'),",
      'the en and ta files',
      "`app_en.arb` / `app_ta.arb`",
      "['en', 'en']",
      "['en', 'fr']",
    ]) {
      assert.deepEqual(findTypedLists(src, codes), [], src);
    }
  });

  test('a `locale-list:` note on the line or the three above exempts it, with its reason', () => {
    assert.deepEqual(findTypedLists("// locale-list: a fixture\nx = ['en', 'ta'];", codes), []);
    assert.deepEqual(findTypedLists("x = ['en', 'ta']; // locale-list: a fixture", codes), []);
    assert.equal(findTypedLists("// locale-list: far away\n\n\n\n\nx = ['en', 'ta'];", codes).length, 1);
  });

  test('a typed list added to a tracked file is named with file and line', () => {
    add('packages/x/lib/y.dart', "void f() {}\nconst l = <String>['en', 'ta', 'hi'];\n");
    const r = verdict();
    assert.ok(has(r, /^L4 packages\/x\/lib\/y\.dart:2 types a list of locales by hand/), r.findings.join('\n'));
  });

  test('an UNTRACKED file is not read (the scan is git ls-files)', () => {
    mkdirSync(join(root, 'packages/x/lib'), { recursive: true });
    writeFileSync(join(root, 'packages/x/lib/z.dart'), "const l = <String>['en', 'ta'];\n");
    assert.ok(!has(verdict(), /z\.dart/));
  });

  test('the extension factory is out of scope by name', () => {
    add('extensions/Extension/X/make.mjs', "const L = ['en', 'ta', 'hi'];\n");
    assert.ok(!has(verdict(), /extensions\//));
  });

  test('a scan below the floor is COVERAGE LOST on the default floor', () => {
    const r = check(root);
    assert.ok(MIN_SCANNED > 50);
    assert.match(r.coverage ?? '', /L4 scanned \d+ source file\(s\); the floor is/);
  });
});

describe('L5 the named consumers read the register', () => {
  test('the chassis picker re-typing its list is named', () => {
    edit('packages/chassis_screens/lib/settings/settings_screen.dart', (s) => s.replaceAll('kSupportedLocales', 'kTypedLocales'));
    assert.ok(has(verdict(), /^L5 packages\/chassis_screens\/lib\/settings\/settings_screen\.dart no longer reads the register/));
  });

  test('the privacy-notice guard going back to the brick is named', () => {
    edit('tooling/ci/assert-policy-archive.mjs', (s) => s.replace("from '../i18n/locales.mjs'", "from './nowhere.mjs'"));
    assert.ok(has(verdict(), /^L5 tooling\/ci\/assert-policy-archive\.mjs/));
  });

  test('a consumer that moved away is named', () => {
    rmSync(join(root, 'tooling/ci/assert-stamp-text-fidelity.mjs'));
    assert.ok(has(verdict(), /^L5 tooling\/ci\/assert-stamp-text-fidelity\.mjs is gone/));
  });
});

describe('the renderer CLI', () => {
  test('--files lists the template file then one per supported code', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'tooling/i18n/locales.mjs'), '--files', 'chassis_localizations', 'dart'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), ['chassis_localizations.dart', ...CODES.map((c) => `chassis_localizations_${c}.dart`)].join(' '));
  });

  test('--check is green on the real tree and red on a stale copy', () => {
    const ok = spawnSync(process.execPath, [join(REPO, 'tooling/i18n/locales.mjs'), '--check'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    edit(`${APP}/macos/Runner/Info.plist`, (s) => s.replace('\t\t<string>ta</string>\n', ''));
    const red = spawnSync(process.execPath, [join(REPO, 'tooling/i18n/locales.mjs'), '--check', '--root', root], { encoding: 'utf8' });
    assert.equal(red.status, 1);
    assert.match(red.stderr, /macos\/Runner\/Info\.plist/);
    assert.ok(existsSync(join(root, REGISTER)));
  });
});

describe('the chassis bridge is dart-format clean', () => {
  // CI's `dart format --set-exit-if-changed apps/` re-wrapped a 3-placeholder
  // member the renderer had left at 81+ columns; these are the shapes it wants.
  const ph = (...names) => Object.fromEntries(names.map((n) => [n, { type: 'String' }]));
  const body = (arb) => renderChassisBridge(arb);
  test('one line, split after =>, then one parameter per line', () => {
    const out = body({
      a: 'x', '@a': { placeholders: ph('n') },
      reacceptTermsNoteLine: 'x', '@reacceptTermsNoteLine': { placeholders: ph('line') },
      reacceptTermsNoteHeading: 'x', '@reacceptTermsNoteHeading': { placeholders: ph('document', 'version', 'date') },
    });
    assert.ok(out.includes('  String a(String n) => _chassis.a(n);\n'));
    assert.ok(out.includes('  String reacceptTermsNoteLine(String line) =>\n      _chassis.reacceptTermsNoteLine(line);\n'));
    assert.ok(out.includes('  String reacceptTermsNoteHeading(\n    String document,\n    String version,\n    String date,\n  ) => _chassis.reacceptTermsNoteHeading(document, version, date);\n'));
    for (const line of out.split('\n')) assert.ok(line.length <= 80, `over 80: ${line}`);
  });
});
