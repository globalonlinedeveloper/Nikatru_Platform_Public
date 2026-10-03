#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// locales.mjs — reads tooling/i18n/locales.json (THE LOCALE REGISTER) and
// renders everything that has to name the set of languages, so nothing else
// types it. [lane i18n-pipeline, O-LOCALES-HAND-TYPED-IN-12-PLACES]
//
// What it renders (`--write` writes, `--check` exits 1 on any drift):
//   - packages/design_system/lib/src/l10n/locale_register.g.dart — the Dart
//     table both Settings pickers and every locale-looping test read;
//   - for every app under apps/ that has the platform folder:
//       ios/Runner/Info.plist and macos/Runner/Info.plist  CFBundleLocalizations
//       android/app/src/main/res/xml/locales_config.xml   + android:localeConfig
//       pubspec.yaml msix_config `languages:`
//
// Other uses, so a shell step or a guard never re-types the list:
//   --codes [--all]            the supported codes, one per line (--all adds pending)
//   --files <stem> <ext>       `<stem>.<ext>` then `<stem>_<code>.<ext>` per supported code,
//                              space-separated (the ci.yml chassis gen-l10n step)
//
// The module half (`loadRegister`, `supportedCodes`, `render*`) is what the
// guards import: tooling/ci/assert-locale-register.mjs grades all of it.
//
// Exit 0 = green / written. 1 = drift under --check, or an invalid register.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';

export const REGISTER = 'tooling/i18n/locales.json';
export const DART_TABLE = 'packages/design_system/lib/src/l10n/locale_register.g.dart';
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2}|-[0-9]{3})?$/;
const CLDR_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const STATUSES = new Set(['supported', 'pending']);
const REQUIRED = ['code', 'englishName', 'nativeName', 'script', 'direction', 'plural', 'status', 'apple', 'android', 'msix'];

/** Problems with the register's shape, as strings. Empty = valid. */
export function validateRegister(reg) {
  const problems = [];
  if (!reg || !Array.isArray(reg.locales) || reg.locales.length === 0) {
    return [`${REGISTER} has no "locales" array — nothing could be derived from it.`];
  }
  const seen = new Set();
  for (const [i, row] of reg.locales.entries()) {
    const at = `${REGISTER} locales[${i}]${row?.code ? ` (${row.code})` : ''}`;
    for (const f of REQUIRED) {
      if (row[f] === undefined || row[f] === '' || row[f] === null) problems.push(`${at} has no "${f}".`);
    }
    if (typeof row.code === 'string' && !TAG.test(row.code)) problems.push(`${at}: "${row.code}" is not a BCP-47 tag of the form ll, ll-RR or ll-Ssss-RR.`);
    if (seen.has(row.code)) problems.push(`${at}: "${row.code}" is declared twice.`);
    seen.add(row.code);
    if (row.direction !== 'ltr' && row.direction !== 'rtl') problems.push(`${at}: direction "${row.direction}" is neither ltr nor rtl.`);
    if (!STATUSES.has(row.status)) problems.push(`${at}: status "${row.status}" is neither supported nor pending.`);
    if (!Array.isArray(row.plural) || !row.plural.includes('other') || row.plural.some((c) => !CLDR_CATEGORIES.has(c))) {
      problems.push(`${at}: plural must list CLDR categories and include "other" (every ICU plural needs an other arm).`);
    }
    if (typeof row.script === 'string' && !/^[A-Z][a-z]{3}$/.test(row.script)) problems.push(`${at}: script "${row.script}" is not an ISO 15924 code.`);
    if (typeof row.msix === 'string' && row.msix !== row.msix.toLowerCase()) problems.push(`${at}: msix "${row.msix}" must be lowercase (the msix tool writes it verbatim).`);
  }
  if (!reg.locales.some((r) => r.code === reg.sourceLocale && r.status === 'supported')) {
    problems.push(`${REGISTER} sourceLocale "${reg.sourceLocale}" is not a supported row — the template ARB has no language.`);
  }
  for (const [i, p] of (reg.pseudo ?? []).entries()) {
    if (!/^[a-z]{2}-X[A-Z]$/.test(p.code ?? '')) problems.push(`${REGISTER} pseudo[${i}]: "${p.code}" is not a pseudo tag (ll-XA).`);
    if (p.direction !== 'ltr' && p.direction !== 'rtl') problems.push(`${REGISTER} pseudo[${i}]: direction must be ltr or rtl.`);
    if (seen.has(p.code)) problems.push(`${REGISTER} pseudo[${i}]: "${p.code}" collides with a real locale.`);
  }
  return problems;
}

export function loadRegister(root = DEFAULT_ROOT) {
  const reg = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  const problems = validateRegister(reg);
  if (problems.length) {
    const e = new Error(problems.join('\n'));
    e.problems = problems;
    throw e;
  }
  return reg;
}

export const supportedRows = (reg) => reg.locales.filter((r) => r.status === 'supported');
export const supportedCodes = (reg) => supportedRows(reg).map((r) => r.code);
/** The ARB / gen-l10n file suffix: `pt-BR` -> `pt_BR`. */
export const arbSuffix = (code) => code.replace(/-/g, '_');

// ── the Dart table ───────────────────────────────────────────────────────────
const dq = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;

export function renderDartTable(reg) {
  const row = (r, pseudo) => {
    const lines = [
      `  RegisteredLocale(`,
      `    code: ${dq(r.code)},`,
      `    englishName: ${dq(r.englishName ?? r.code)},`,
      `    nativeName: ${dq(r.nativeName ?? r.code)},`,
      `    script: ${dq(r.script ?? 'Latn')},`,
      `    rtl: ${r.direction === 'rtl'},`,
      `    plural: <String>[${(r.plural ?? ['other']).map(dq).join(', ')}],`,
      `    supported: ${!pseudo && r.status === 'supported'},`,
      `    pseudo: ${pseudo},`,
      `  ),`,
    ];
    return lines.join('\n');
  };
  const pseudo = (reg.pseudo ?? []).map((p) => ({ ...p, englishName: p.code, nativeName: p.code, script: 'Latn', plural: ['one', 'other'] }));
  return `// GENERATED by \`node tooling/i18n/locales.mjs --write\` from
// tooling/i18n/locales.json. NEVER HAND-EDIT: tooling/ci/assert-locale-register.mjs
// fails CI when this file and the register disagree.
//
// THE ONE LIST OF LANGUAGES the Dart side reads: both Settings pickers offer
// \`kSupportedLocales\`, and every test that loops over the locales loops over
// \`kSupportedLocaleCodes\` — so a language added to the register reaches every
// picker and every such test without a hand edit, and one missing an ARB fails
// the guard before it can render English under a native name.
import 'package:flutter/widgets.dart' show Locale;

/// One row of the locale register.
class RegisteredLocale {
  const RegisteredLocale({
    required this.code,
    required this.englishName,
    required this.nativeName,
    required this.script,
    required this.rtl,
    required this.plural,
    required this.supported,
    required this.pseudo,
  });

  /// The BCP-47 tag, e.g. \`ta\` or \`pt-BR\`.
  final String code;

  /// The language's name in English (for logs and tooling, never the picker).
  final String englishName;

  /// The language's name in ITSELF — what the picker shows, so a reader finds
  /// their language without first being able to read the current one.
  final String nativeName;

  /// ISO 15924 script code.
  final String script;

  /// Written right to left.
  final bool rtl;

  /// The CLDR cardinal plural categories the language uses.
  final List<String> plural;

  /// Ships everywhere (\`status: supported\`); false for pending and pseudo rows.
  final bool supported;

  /// A test-only pseudo locale (never shipped, never offered in a picker).
  final bool pseudo;

  /// The [Locale] this row selects.
  Locale get locale {
    final List<String> parts = code.split('-');
    return parts.length == 1
        ? Locale(parts[0])
        : Locale.fromSubtags(
            languageCode: parts[0],
            countryCode: parts.length > 1 && parts.last.length != 4
                ? parts.last
                : null,
            scriptCode: parts[1].length == 4 ? parts[1] : null,
          );
  }
}

/// Every row of the register, supported first, then pending, then pseudo.
const List<RegisteredLocale> kLocaleRegister = <RegisteredLocale>[
${[...reg.locales.filter((r) => r.status === 'supported'), ...reg.locales.filter((r) => r.status !== 'supported')].map((r) => row(r, false)).join('\n')}
${pseudo.map((p) => row(p, true)).join('\n')}
];

/// The template (source) locale's code.
const String kSourceLocaleCode = ${dq(reg.sourceLocale)};

/// The supported rows, in register order.
final List<RegisteredLocale> kSupportedLocales =
    List<RegisteredLocale>.unmodifiable(
      kLocaleRegister.where((RegisteredLocale r) => r.supported),
    );

/// The supported codes, in register order.
final List<String> kSupportedLocaleCodes = List<String>.unmodifiable(
  kSupportedLocales.map((RegisteredLocale r) => r.code),
);

/// The [Locale] of the supported row whose code is [code] — what a picker
/// stores when a tile is chosen. Throws for a code the register does not
/// support, which a picker built from [kSupportedLocales] cannot hand it.
Locale localeOfCode(String code) =>
    kSupportedLocales.firstWhere((RegisteredLocale r) => r.code == code).locale;

/// The supported codes other than the source locale — the translations.
final List<String> kTranslationLocaleCodes = List<String>.unmodifiable(
  kSupportedLocaleCodes.where((String c) => c != kSourceLocaleCode),
);

/// The test-only pseudo rows (\`en-XA\` long text, \`ar-XB\` right to left).
final List<RegisteredLocale> kPseudoLocales =
    List<RegisteredLocale>.unmodifiable(
      kLocaleRegister.where((RegisteredLocale r) => r.pseudo),
    );
`;
}

// ── native declarations ──────────────────────────────────────────────────────
const PLIST_KEY = 'CFBundleLocalizations';

/** Info.plist with CFBundleLocalizations set to `codes` (inserted after
 *  CFBundleDevelopmentRegion's value, or replaced in place). Tabs, as Xcode writes. */
export function renderInfoPlist(src, codes) {
  const block = `\t<key>${PLIST_KEY}</key>\n\t<array>\n${codes.map((c) => `\t\t<string>${c}</string>\n`).join('')}\t</array>\n`;
  const existing = new RegExp(`[ \\t]*<key>${PLIST_KEY}</key>\\s*<array>[\\s\\S]*?</array>\\n`);
  if (existing.test(src)) return src.replace(existing, block);
  const anchor = /([ \t]*<key>CFBundleDevelopmentRegion<\/key>\s*\n[ \t]*<string>[^<]*<\/string>\n)/;
  if (!anchor.test(src)) return null;
  return src.replace(anchor, `$1${block}`);
}

// 🔴 No double hyphen anywhere in this comment: XML forbids it inside a comment,
// and Android's resource compiler then refuses the whole build (#597).
export function renderLocalesConfig(codes) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by tooling/i18n/locales.mjs (write mode) from tooling/i18n/locales.json.
     NEVER HAND-EDIT: tooling/ci/assert-locale-register.mjs fails CI on drift.
     Android 13+ lists exactly these in the system's per-app language setting. -->
<locale-config xmlns:android="http://schemas.android.com/apk/res/android">
${codes.map((c) => `    <locale android:name="${c}"/>`).join('\n')}
</locale-config>
`;
}

const LOCALE_CONFIG_ATTR = 'android:localeConfig="@xml/locales_config"';
export function renderManifest(src) {
  if (src.includes(LOCALE_CONFIG_ATTR)) return src;
  const m = src.match(/(\n([ \t]*)<application\b)/);
  if (!m) return null;
  return src.replace(m[1], `${m[1]}\n${m[2]}    ${LOCALE_CONFIG_ATTR}`);
}

export function renderMsixLanguages(src, tags) {
  const re = /^(\s*languages:)[^\n]*$/m;
  if (!/^msix_config:/m.test(src)) return src; // no MSIX packaging in this app
  if (!re.test(src)) return null;
  return src.replace(re, `$1 ${tags.join(', ')}`);
}

// ── the chassis bridge ─────────────────────────────────────────────────────
export const CHASSIS_ARB = 'packages/design_system/lib/src/l10n/chassis_en.arb';

/**
 * `apps/<id>/lib/l10n/chassis_bridge.g.dart`: an extension on the app's
 * `AppLocalizations` that answers every CHASSIS key from `ChassisLocalizations`
 * in the same locale. ARB hygiene (lane i18n-pipeline, item 6): the app ARB
 * re-declared 172 chassis keys with identical values, so every translation pass
 * paid for them twice. With the bridge the app ARB declares only its own keys,
 * and `l10n.signInTitle` at an app call site reads the chassis key — one string,
 * one translation. A key the app still declares itself wins (a class member
 * shadows an extension member), so an app can override deliberately.
 */
export function renderChassisBridge(chassisArb) {
  const members = [];
  for (const k of Object.keys(chassisArb).filter((x) => !x.startsWith('@')).sort()) {
    const ph = chassisArb[`@${k}`]?.placeholders;
    if (!ph || !Object.keys(ph).length) {
      const g = `  String get ${k} => _chassis.${k};`;
      members.push(g.length <= 80 ? g : `  String get ${k} =>\n      _chassis.${k};`);
      continue;
    }
    const params = Object.entries(ph).map(([n, d]) => {
      if (!d?.type) throw new Error(`${CHASSIS_ARB} @${k}.placeholders.${n} declares no type — the bridge cannot know gen-l10n's parameter type.`);
      return [d.type, n];
    });
    const sig = params.map(([t, n]) => `${t} ${n}`).join(', ');
    const call = params.map(([, n]) => n).join(', ');
    const one = `  String ${k}(${sig}) => _chassis.${k}(${call});`;
    const head = `  String ${k}(${sig}) =>`;
    // dart format's three shapes, narrowest last: one line; split after `=>`;
    // and, once the signature alone passes 80, one parameter per line.
    if (one.length <= 80) members.push(one);
    else if (head.length <= 80) members.push(`${head}\n      _chassis.${k}(${call});`);
    else {
      const tail = `  ) => _chassis.${k}(${call});`;
      const close = tail.length <= 80 ? tail : `  ) =>\n      _chassis.${k}(${call});`;
      members.push(`  String ${k}(\n${params.map(([t, n]) => `    ${t} ${n},\n`).join('')}${close}`);
    }
  }
  return `// GENERATED by \`node tooling/i18n/locales.mjs --write\` from
// packages/design_system/lib/src/l10n/chassis_en.arb. NEVER HAND-EDIT:
// tooling/ci/assert-locale-register.mjs fails CI when the two disagree.
//
// The app reads every CHASSIS string through this bridge rather than
// re-declaring it in its own ARB (lane i18n-pipeline, ARB hygiene): one key,
// one translation, in one place. A key the app ARB still declares wins.
import 'package:flutter/widgets.dart' show Locale;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisLocalizations, lookupChassisLocalizations;

import 'app_localizations.dart';

// Re-exported so a call site imports ONE file for both its own keys and the
// chassis keys — the bridge replaces the app_localizations.dart import.
export 'app_localizations.dart';

/// The chassis strings, read through the app's own localizations object.
extension ChassisBridge on AppLocalizations {
  /// How the bridge finds the chassis strings for a locale. Only a test that
  /// pumps a pseudo locale (whose chassis strings no real lookup can give)
  /// points it elsewhere, and restores it in tearDown.
  static ChassisLocalizations Function(Locale locale) lookup =
      lookupChassisLocalizations;

  ChassisLocalizations get _chassis {
    final List<String> parts = localeName.split('_');
    return lookup(
      Locale.fromSubtags(
        languageCode: parts.first,
        countryCode: parts.length > 1 ? parts.last : null,
      ),
    );
  }

${members.join('\n\n')}
}
`;
}

/** Every generated or rewritten file, as {path, want, have, note}. `want` null
 *  means the anchor the renderer needs was not found (a finding, not a skip). */
export function plan(root = DEFAULT_ROOT, reg = loadRegister(root)) {
  const rows = supportedRows(reg);
  const out = [];
  const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
  out.push({ path: DART_TABLE, want: renderDartTable(reg), have: read(DART_TABLE) });
  const appsDir = join(root, 'apps');
  const apps = existsSync(appsDir)
    ? listDir(appsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(appsDir, e.name, 'pubspec.yaml')))
        .map((e) => e.name)
        .sort()
    : [];
  for (const app of apps) {
    for (const os of ['ios', 'macos']) {
      const rel = `apps/${app}/${os}/Runner/Info.plist`;
      const have = read(rel);
      if (have !== null) out.push({ path: rel, want: renderInfoPlist(have, rows.map((r) => r.apple)), have, note: `${PLIST_KEY} (no CFBundleDevelopmentRegion anchor)` });
    }
    const manifest = `apps/${app}/android/app/src/main/AndroidManifest.xml`;
    const mHave = read(manifest);
    if (mHave !== null) {
      out.push({ path: manifest, want: renderManifest(mHave), have: mHave, note: 'android:localeConfig (no <application> element)' });
      const cfg = `apps/${app}/android/app/src/main/res/xml/locales_config.xml`;
      out.push({ path: cfg, want: renderLocalesConfig(rows.map((r) => r.android)), have: read(cfg) });
    }
    const appArb = `apps/${app}/lib/l10n/app_en.arb`;
    const chassis = read(CHASSIS_ARB);
    if (read(appArb) !== null && chassis !== null) {
      const bridge = `apps/${app}/lib/l10n/chassis_bridge.g.dart`;
      out.push({ path: bridge, want: renderChassisBridge(JSON.parse(chassis)), have: read(bridge) });
    }
    const pub = `apps/${app}/pubspec.yaml`;
    const pHave = read(pub);
    if (pHave !== null && /^msix_config:/m.test(pHave)) {
      out.push({ path: pub, want: renderMsixLanguages(pHave, rows.map((r) => r.msix)), have: pHave, note: 'msix_config languages: (no languages: line)' });
    }
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv) {
  const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : DEFAULT_ROOT;
  let reg;
  try {
    reg = loadRegister(root);
  } catch (e) {
    console.error(`✗ ${REGISTER} is invalid:\n  ${(e.problems ?? [e.message]).join('\n  ')}`);
    return 1;
  }
  if (argv.includes('--codes')) {
    const codes = argv.includes('--all') ? reg.locales.map((r) => r.code) : supportedCodes(reg);
    process.stdout.write(codes.join('\n') + '\n');
    return 0;
  }
  if (argv.includes('--files')) {
    const i = argv.indexOf('--files');
    const [stem, ext] = [argv[i + 1], argv[i + 2]];
    if (!stem || !ext) {
      console.error('usage: --files <stem> <ext>');
      return 1;
    }
    process.stdout.write([`${stem}.${ext}`, ...supportedCodes(reg).map((c) => `${stem}_${arbSuffix(c)}.${ext}`)].join(' ') + '\n');
    return 0;
  }
  const write = argv.includes('--write');
  const items = plan(root, reg);
  let drift = 0;
  for (const it of items) {
    if (it.want === null) {
      console.error(`✗ ${it.path}: cannot render ${it.note}.`);
      drift++;
      continue;
    }
    if (it.want === it.have) continue;
    if (write) {
      mkdirSync(dirname(join(root, it.path)), { recursive: true });
      writeFileSync(join(root, it.path), it.want);
      console.log(`wrote ${it.path}`);
    } else {
      console.error(`✗ ${it.path} is not what ${REGISTER} renders — run \`node tooling/i18n/locales.mjs --write\`.`);
      drift++;
    }
  }
  if (!write && drift === 0) console.log(`✓ ${items.length} file(s) derived from ${REGISTER} are current (${supportedCodes(reg).join(', ')}).`);
  return drift ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
