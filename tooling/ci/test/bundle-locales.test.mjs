// ─────────────────────────────────────────────────────────────────────────────
// bundle-locales.test.mjs — assert-bundle-locales.mjs must be able to FAIL.
//
// C-18 / C-20 (train P38, 2026-10-01). The guard derives the locale set from the
// arbs gen-l10n reads and holds every native bundle, every store channel and the
// launcher label against it. Each case below builds a synthetic workspace whose
// one app is compliant, then breaks exactly one surface.
//
// FIRST EVIDENCE WAS THE REAL TREE, not this file: the guard run against the
// unchanged base commit exited 1 with twelve findings — msix en-us only, no
// CFBundleLocalizations on iOS or macOS, knownRegions ( en, Base ) twice, no
// android:localeConfig, and six channels with no ta listing and no exemption.
// That is C-18's evidence, reproduced by the guard rather than by a reader.
//
// Run:  node --test tooling/ci/test/bundle-locales.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { covers, gradeBundleLocales, normTag } from '../assert-bundle-locales.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = resolve(HERE, '..', 'assert-bundle-locales.mjs');
const REPO = resolve(HERE, '..', '..', '..');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-bundle-locales-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

const APP = 'apps/demo';
const plist = (display, locs) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n' +
  `\t<key>CFBundleDisplayName</key>\n\t<string>${display}</string>\n` +
  (locs === null ? '' : `\t<key>CFBundleLocalizations</key>\n\t<array>\n${locs.map((l) => `\t\t<string>${l}</string>\n`).join('')}\t</array>\n`) +
  '</dict>\n</plist>\n';
const pbx = (regions) => `\t\t\tknownRegions = (\n${regions.map((r) => `\t\t\t\t${r},\n`).join('')}\t\t\t);\n`;
const manifest = ({ label = 'Demo', localeConfig = '@xml/locales_config' } = {}) =>
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <!-- <application android:localeConfig="@xml/in_a_comment"> -->\n' +
  `    <application\n        android:label="${label}"\n` +
  (localeConfig === null ? '' : `        android:localeConfig="${localeConfig}"\n`) +
  '        android:icon="@mipmap/ic_launcher">\n    </application>\n</manifest>\n';
const localesXml = (locs) =>
  `<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n${locs.map((l) => `    <locale android:name="${l}" />\n`).join('')}</locale-config>\n`;
const CHANNELS = ['android-play', 'windows-store'];
const exemption = (channel, over = {}) => ({ channel, locale: 'ta', since: '2026-10-01', row: 'O-DEMO-ROW', why: 'awaiting native review', ...over });

/** A compliant one-app workspace. Every key is one surface; `null` omits it. */
function tree(over = {}) {
  const o = {
    arbs: { en: { '@@locale': 'en', appTitle: 'Demo Brand' }, ta: { '@@locale': 'ta', appTitle: 'Demo Brand' } },
    l10nYaml: 'arb-dir: lib/l10n\ntemplate-arb-file: app_en.arb\noutput-localization-file: app_localizations.dart\n',
    appYaml: 'id: demo\nname: Demo Brand App\nshortName: Demo\n',
    msix: 'en-us, ta-in',
    iosPlist: plist('Demo', ['en', 'ta']),
    macosPlist: plist('Demo', ['en', 'ta']),
    iosPbx: pbx(['en', 'Base', 'ta']),
    macosPbx: pbx(['en', 'Base', 'ta']),
    manifest: manifest(),
    localesXml: localesXml(['en', 'ta']),
    channels: CHANNELS,
    listings: [], // `${channel}/${locale}` with a title.txt
    exemptions: CHANNELS.map((c) => exemption(c)),
    extra: {},
    workspace: `workspace:\n  - ${APP}\n`,
    ...over,
  };
  const root = join(TMP, `r${seq++}`);
  const files = { 'pubspec.yaml': `name: ws\n${o.workspace}` };
  const at = (rel, body) => { if (body !== null) files[`${APP}/${rel}`] = body; };
  for (const [loc, body] of Object.entries(o.arbs ?? {})) at(`lib/l10n/app_${loc}.arb`, JSON.stringify(body));
  at('l10n.yaml', o.l10nYaml);
  at('app.yaml', o.appYaml);
  at('pubspec.yaml', o.msix === null ? 'name: demo\n' : `name: demo\nmsix_config:\n  display_name: Demo Brand App\n  languages: ${o.msix} # a trailing comment\n`);
  if (o.msix !== undefined) at('windows/runner/main.cpp', '// placeholder\n');
  at('ios/Runner/Info.plist', o.iosPlist);
  at('ios/Runner.xcodeproj/project.pbxproj', o.iosPbx);
  at('macos/Runner/Info.plist', o.macosPlist);
  at('macos/Runner.xcodeproj/project.pbxproj', o.macosPbx);
  at('android/app/src/main/AndroidManifest.xml', o.manifest);
  at('android/app/src/main/res/xml/locales_config.xml', o.localesXml);
  for (const c of o.channels ?? []) at(`store/${c}/title.txt`, 'Demo Brand App\n');
  for (const l of o.listings) at(`store/${l}/title.txt`, 'தமிழ்\n');
  if (o.exemptions !== null) at('store/listing-locales.json', JSON.stringify({ exemptions: o.exemptions }));
  for (const [rel, body] of Object.entries(o.extra)) files[rel] = body;
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}
const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-bundle-locales', () => {
  test('GREEN CONTROL: a workspace whose every surface declares the arb set passes', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /assert-bundle-locales: ok — \d+ surface\(s\) compared/);
    assert.match(out, /demo \[en, ta\]/);
  });

  test('the real repository passes', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    assert.match(out, /subscriptiontracker \[en, hi, ta\]/);
  });

  describe('A · bundles declare exactly the arb set', () => {
    const redsWith = (over, re) => {
      const { code, out } = run(tree(over));
      assert.equal(code, 1, out);
      assert.match(out, re);
    };
    test('FAILS on msix languages without ta', () => redsWith({ msix: 'en-us' }, /msix_config\.languages does not declare ta/));
    test('FAILS on an msix language with no region', () => redsWith({ msix: 'en-us, ta' }, /carries "ta", which is not language-REGION/));
    test('FAILS on iOS with no CFBundleLocalizations', () => redsWith({ iosPlist: plist('Demo', null) }, /ios\/Runner\/Info\.plist declares no `CFBundleLocalizations`/));
    test('FAILS on macOS CFBundleLocalizations without ta', () => redsWith({ macosPlist: plist('Demo', ['en']) }, /macos\/Runner\/Info\.plist CFBundleLocalizations does not declare ta/));
    test('FAILS on iOS knownRegions without ta', () => redsWith({ iosPbx: pbx(['en', 'Base']) }, /ios\/Runner\.xcodeproj\/project\.pbxproj knownRegions does not declare ta/));
    test('FAILS on a locale no arb provides', () => redsWith({ macosPbx: pbx(['en', 'Base', 'ta', 'fr']) }, /knownRegions declares fr, which no arb provides/));
    test('FAILS on no android:localeConfig (a commented one does not count)', () => redsWith({ manifest: manifest({ localeConfig: null }) }, /declares no `android:localeConfig="@xml\/…"`/));
    test('FAILS on a localeConfig pointing at nothing', () => redsWith({ localesXml: null }, /res\/xml\/locales_config\.xml does not exist/));
    test('FAILS on a locales_config without ta', () => redsWith({ localesXml: localesXml(['en']) }, /locales_config\.xml does not declare ta/));

    // THE DERIVATION, as an input: nothing in the guard names `ta`, so adding
    // an arb must red every surface that does not declare it yet.
    test('a NEW arb reds every bundle surface until each declares it', () => {
      const { code, out } = run(tree({ extra: { [`${APP}/lib/l10n/app_hi.arb`]: JSON.stringify({ '@@locale': 'hi', appTitle: 'Demo Brand' }) } }));
      assert.equal(code, 1, out);
      for (const surface of ['msix_config.languages', 'ios/Runner/Info.plist CFBundleLocalizations', 'macos/Runner/Info.plist CFBundleLocalizations', 'ios/Runner.xcodeproj/project.pbxproj knownRegions', 'macos/Runner.xcodeproj/project.pbxproj knownRegions', 'locales_config.xml']) {
        assert.ok(out.includes(`${surface} does not declare hi`), `${surface} did not demand hi:\n${out}`);
      }
      assert.match(out, /store\/android-play has no hi listing/);
    });

    test('an absent native tree is printed, not graded', () => {
      const { code, out } = run(tree({ manifest: null, localesXml: null, iosPlist: null, iosPbx: null }));
      assert.equal(code, 0, out);
      assert.match(out, /⬜ apps\/demo: no android\/ tree/);
      assert.match(out, /⬜ apps\/demo: no ios\/ tree/);
    });

    test('COVERAGE LOST when ios/ exists and its Info.plist does not', () => {
      const { code, out } = run(tree({ iosPlist: null }));
      assert.equal(code, 2, out);
      assert.match(out, /COVERAGE LOST/);
      assert.match(out, /ios\/Runner\/Info\.plist does not exist although apps\/demo\/ios\/ does/);
    });
  });

  describe('B · listings, or a dated exemption that prints', () => {
    test('an exempt channel PRINTS an owner line and passes', () => {
      const { code, out } = run(tree());
      assert.equal(code, 0, out);
      assert.match(out, /👤 OWNER apps\/demo\/store\/android-play: no ta listing, exempt since 2026-10-01 pending O-DEMO-ROW/);
    });

    test('FAILS on a missing listing with no exemption', () => {
      const { code, out } = run(tree({ exemptions: [exemption('android-play')] }));
      assert.equal(code, 1, out);
      assert.match(out, /store\/windows-store has no ta listing .* carries no dated exemption/);
    });

    test('FAILS when the register is absent and a listing is missing', () => {
      const { code, out } = run(tree({ exemptions: null }));
      assert.equal(code, 1, out);
      assert.match(out, /store\/android-play has no ta listing/);
    });

    test('a real ta listing needs no exemption', () => {
      const { code, out } = run(tree({ listings: ['android-play/ta', 'windows-store/ta'], exemptions: [] }));
      assert.equal(code, 0, out);
      assert.doesNotMatch(out, /OWNER/);
    });

    test('FAILS on a STALE exemption — the listing exists', () => {
      const { code, out } = run(tree({ listings: ['android-play/ta'] }));
      assert.equal(code, 1, out);
      assert.match(out, /exempts android-play\/ta and .* EXISTS\. The waiver is stale/);
    });

    const exemptionRedsWith = (over, re) => {
      const { code, out } = run(tree({ exemptions: [exemption('android-play', over), exemption('windows-store')] }));
      assert.equal(code, 1, out);
      assert.match(out, re);
    };
    test('FAILS on an undated exemption', () => exemptionRedsWith({ since: undefined }, /carries no `since` date/));
    test('FAILS on a malformed date', () => exemptionRedsWith({ since: '1 Oct 2026' }, /carries no `since` date/));
    test('FAILS on a date in the future', () => exemptionRedsWith({ since: '2999-01-01' }, /is dated 2999-01-01, after today/));
    test('FAILS on no owner row', () => exemptionRedsWith({ row: 'someday' }, /names no owner row/));
    test('FAILS on no reason', () => exemptionRedsWith({ why: ' ' }, /carries no `why`/));

    test('FAILS on an exemption for a channel or locale that does not exist', () => {
      const { code, out } = run(tree({ exemptions: [...CHANNELS.map((c) => exemption(c)), exemption('fax-store'), exemption('android-play', { locale: 'fr' })] }));
      assert.equal(code, 1, out);
      assert.match(out, /"fax-store".* names a channel with no listing/);
      assert.match(out, /"locale":"fr"\} names a locale that is not a non-template arb locale/);
    });

    test('FAILS on a duplicated exemption', () => {
      const { code, out } = run(tree({ exemptions: [...CHANNELS.map((c) => exemption(c)), exemption('android-play')] }));
      assert.equal(code, 1, out);
      assert.match(out, /exempts android-play\/ta twice/);
    });
  });

  describe('C · the launcher label is localised or the brand', () => {
    test('the brand label prints its exemption and passes', () => {
      const { code, out } = run(tree());
      assert.equal(code, 0, out);
      assert.match(out, /launcher label is the brand "Demo" .* brand-exempt while every arb keeps appTitle "Demo Brand" untranslated/);
    });

    test('FAILS on a literal label that is not the brand', () => {
      const { code, out } = run(tree({ manifest: manifest({ label: 'My Subscriptions' }) }));
      assert.equal(code, 1, out);
      assert.match(out, /android:label is "My Subscriptions", an untranslated literal that is not the brand/);
    });

    test('FAILS on the brand label once a locale TRANSLATES appTitle', () => {
      const { code, out } = run(tree({ arbs: { en: { appTitle: 'Demo Brand' }, ta: { appTitle: 'டெமோ' } } }));
      assert.equal(code, 1, out);
      assert.match(out, /ta's appTitle is translated .* must be localised for ta/);
    });

    test('a localised @string label needs a values-<locale> entry for every arb locale', () => {
      const red = run(tree({ manifest: manifest({ label: '@string/app_label' }), extra: { [`${APP}/android/app/src/main/res/values/strings.xml`]: '<resources><string name="app_label">Demo</string></resources>' } }));
      assert.equal(red.code, 1, red.out);
      assert.match(red.out, /res\/values-ta\/strings\.xml does not define it/);
      const green = run(tree({
        manifest: manifest({ label: '@string/app_label' }),
        extra: {
          [`${APP}/android/app/src/main/res/values/strings.xml`]: '<resources><string name="app_label">Demo</string></resources>',
          [`${APP}/android/app/src/main/res/values-ta/strings.xml`]: '<resources><string name="app_label">டெமோ</string></resources>',
        },
      }));
      assert.equal(green.code, 0, green.out);
    });
  });

  describe('D · a run that compared nothing is COVERAGE LOST', () => {
    test('no app in the workspace', () => {
      const { code, out } = run(tree({ workspace: 'workspace:\n  - packages/x\n' }));
      assert.equal(code, 2, out);
      assert.match(out, /declares no `workspace:` entry under apps\//);
    });

    test('an app with no l10n.yaml', () => {
      const { code, out } = run(tree({ l10nYaml: null }));
      assert.equal(code, 2, out);
      assert.match(out, /l10n\.yaml does not exist/);
    });

    test('an app whose template arb is gone', () => {
      const { code, out } = run(tree({ arbs: { ta: { appTitle: 'Demo Brand' } } }));
      assert.equal(code, 2, out);
      assert.match(out, /app_en\.arb \(the template arb\) does not exist/);
    });

    test('an app with no native tree, no store and no label', () => {
      const { code, out } = run(tree({ msix: undefined, iosPlist: null, iosPbx: null, macosPlist: null, macosPbx: null, manifest: null, localesXml: null, channels: [], exemptions: null }));
      assert.equal(code, 2, out);
      assert.match(out, /every app was skipped before a single bundle, listing or label was compared/);
    });
  });

  describe('the tag comparison', () => {
    test('normTag and covers', () => {
      assert.equal(normTag('pt_BR'), 'pt-br');
      assert.ok(covers('en-us', 'en'));
      assert.ok(covers('ta', 'ta'));
      assert.ok(!covers('tam', 'ta'), 'a prefix that is not a subtag boundary must not match');
      assert.ok(!covers('en', 'en_US'), 'a bare language does not cover a regional arb');
    });

    test('gradeBundleLocales is pure over its root', () => {
      const r = gradeBundleLocales(tree(), { today: '2026-10-01' });
      assert.deepEqual(r.problems, []);
      assert.deepEqual(r.lost, []);
      assert.ok(r.checked > 0);
    });
  });
});
