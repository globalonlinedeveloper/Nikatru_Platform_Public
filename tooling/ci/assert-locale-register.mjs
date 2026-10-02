#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-locale-register.mjs — ONE locale register, and every surface reads it.
//
// Row: O-LOCALES-HAND-TYPED-IN-12-PLACES (and the localisation-pipeline row).
// The set "en, ta, hi" was typed by hand in at least twelve places — the two
// Settings pickers, both parity tests, the CI regeneration step, the notice-per-
// locale limb, the stamp fidelity guard, the content-pack recipe, the native
// manifests — and two of them had already drifted: the brick shipped en+ta while
// the chassis picker offered Hindi (a dead control in every new app), and the
// notice limb read the brick, so Hindi was invisible to the K-14 duty. Adding a
// language was a multi-file hand edit with nothing to say which file was missed.
//
// tooling/i18n/locales.json is now the list. This guard holds the tree to it:
//
//   L1 register   the register parses and every row is well-formed
//                 (tooling/i18n/locales.mjs registerProblems).
//   L2 generated  packages/design_system/lib/src/l10n/locale_register.g.dart,
//                 every app's android/app/src/main/res/xml/locales_config.xml and
//                 the three auth e-mails (docs/platform/supabase/email-templates/
//                 and their served twins under sites/nikatru/auth-mail/, one Go-
//                 template branch per supported locale) are byte-for-byte what
//                 the register renders (`--write` regenerates).
//   L3 arb sets   every ARB directory — each app's lib/l10n, the chassis, the
//                 brick — holds exactly one <prefix>_<code>.arb per SUPPORTED
//                 code: a missing one is a locale that renders English; an extra
//                 one is a language that ships without being registered.
//   L4 native     every app with native folders declares the supported set:
//                 iOS and macOS Info.plist CFBundleLocalizations, the Android
//                 manifest's android:localeConfig, the MSIX `languages:`.
//   L5 readers    each file that used to carry a hand-typed list now reads the
//                 register (a named pattern per file), so a revert is a finding.
//   L6 hand-typed no locale list outside the register: two or more distinct
//                 register codes as adjacent quoted tokens in code (comments
//                 stripped), in any scanned file not in EXEMPT below.
//   L9 dedupe     no app or brick ARB redeclares a chassis key; an app reads the
//                 chassis value (context.chassisL10n, or `l10n.<key>` through the
//                 generated lib/l10n/chassis_keys.g.dart its l10n.yaml exports).
//   L8 rtl        no UI file (apps/*/lib, packages/*/lib, the brick's lib) lays
//                 out hard-wired left-to-right: an asymmetric EdgeInsets.fromLTRB,
//                 a one-sided EdgeInsets.only or Positioned, a non-gradient
//                 Alignment.*Left/*Right, TextAlign.left/right. Each has a
//                 Directional twin that is identical in LTR and mirrors in RTL.
//   L7 copy       the server-side copy tables — the renewal digest's
//                 (services/platform/src/lib/digest-copy.json) and the auth
//                 e-mails' (tooling/i18n/auth-mail-copy.json) — carry a complete
//                 block for EXACTLY the supported set: a missing one is a user
//                 whose stored language silently reads English.
//
// Exit 0 = green. 1 = a finding. 2 = COVERAGE LOST: the register is absent, the
// scan did not reach every named reader, or no app had native folders to grade.
//
// Usage: node tooling/ci/assert-locale-register.mjs [--write] [--root <dir>]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listDir } from './tree-walk.mjs';
import { REGISTER_REL, registerProblems, supportedLocales } from '../i18n/locales.mjs';
import { AUTH_MAIL_COPY_REL, AUTH_MAIL_OUT_DIRS, authMailCopyProblems, renderAuthMail } from '../i18n/auth-mail.mjs';

export const DART_REGISTER = 'packages/design_system/lib/src/l10n/locale_register.g.dart';
export const LOCALES_CONFIG = 'android/app/src/main/res/xml/locales_config.xml';
export const DIGEST_COPY = 'services/platform/src/lib/digest-copy.json';
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

/** Every ARB directory and its file prefix. Apps are discovered, not listed. */
const FIXED_ARB_DIRS = [
  { dir: 'packages/design_system/lib/src/l10n', prefix: 'chassis' },
  { dir: `${BRICK_APP}/lib/l10n`, prefix: 'app' },
];

/** L5 — the files that carried a hand-typed list, and how each reads the register now. */
export const READERS = [
  { file: 'apps/subscriptiontracker/lib/features/settings/settings_screen.dart', must: /kSupportedLocales/, why: 'the app picker offers the register\'s rows' },
  { file: 'packages/chassis_screens/lib/settings/settings_screen.dart', must: /kSupportedLocales/, why: 'the chassis picker offers the register\'s rows' },
  { file: 'apps/subscriptiontracker/test/l10n_parity_test.dart', must: /kSupportedLocaleCodes/, why: 'the app parity test walks the register\'s translations' },
  { file: 'packages/design_system/test/chassis_l10n_parity_test.dart', must: /kSupportedLocaleCodes/, why: 'the chassis parity test walks the register\'s translations' },
  { file: '.github/workflows/ci.yml', must: /node tooling\/i18n\/locales\.mjs --codes/, why: 'the chassis regeneration step checks one generated file per register code' },
  { file: 'tooling/ci/assert-policy-archive.mjs', must: /from '\.\.\/i18n\/locales\.mjs'/, why: 'the notice-per-locale limb (K-14) reads the register, not the brick' },
  { file: 'tooling/ci/assert-stamp-text-fidelity.mjs', must: /from '\.\.\/i18n\/locales\.mjs'/, why: 'a stamped app\'s ARB set is the register\'s' },
  { file: 'tooling/content_pipeline/examples/service-catalogue/make-recipe.mjs', must: /from '\.\.\/\.\.\/\.\.\/i18n\/locales\.mjs'/, why: 'the service catalogue ships every supported locale' },
  { file: 'tooling/release/submit-play.mjs', must: /from '\.\.\/i18n\/locales\.mjs'/, why: 'the Play listing language is the register\'s source row' },
  { file: 'tooling/bricks/app/hooks/post_gen.dart', must: /tooling\/i18n\/locales\.json/, why: 'a stamped app\'s MSIX languages come from the register' },
];

/** L6 — where a hand-typed list may legitimately stand, each with its reason. */
export const EXEMPT = [
  { path: REGISTER_REL, why: 'the register itself' },
  { path: DART_REGISTER, why: 'generated from the register by this guard (L2)' },
  { prefix: 'tooling/ci/test/', why: 'guard tests build synthetic trees: a list there is a fixture input, never a statement of what ships' },
  { prefix: 'tooling/content_pipeline/test/', why: 'pipeline tests build synthetic packs from fixture recipes' },
  { prefix: 'packages/core/test/fixtures/', why: 'a pack-format fixture (en+hi on purpose), not the shipped catalogue' },
  { prefix: 'tooling/content_pipeline/examples/lingo-phrases/', why: 'an example recipe of a different product, not a surface of this factory' },
  { path: 'apps/subscriptiontracker/assets/content_pack/manifest.json', why: 'built from the recipe, which reads the register (L5); assert-pack-roundtrip holds the bytes' },
  { path: 'tooling/content_pipeline/examples/service-catalogue/recipe.json', why: 'rendered by make-recipe.mjs, which reads the register (L5)' },
  { path: 'tooling/scripts/assert-no-dead-files.mjs', why: 'quotes the lingo-phrases recipe in a note' },
  { path: 'packages/design_system/test/swallow_system_back_test.dart', why: 'a resolution-logic fixture: the supported list there is an input to resolve against, not the app\'s' },
];

/** L8 — the UI trees held to direction-neutral layout: every app's lib, every
 *  package's lib, the brick's lib. Each is a regex source anchored at the path's start. */
const RTL_TREES = ['apps/[^/]+/lib/', 'packages/[^/]+/lib/', 'tooling/bricks/app/__brick__/apps/\\{\\{app_id\\}\\}/lib/'];

/** What L6 reads. Everything under these roots with one of these extensions. */
const SCAN_ROOTS = ['apps', 'packages', 'tooling', 'services', '.github'];
const SCAN_EXT = /\.(dart|mjs|js|cjs|ts|yml|yaml|json|sh|kts|gradle|xml|plist)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.dart_tool', 'goldens', 'Pods', '.git', 'ephemeral']);

/** The files L6 reads: the TRACKED files when [root] is a checkout (gen-l10n output is
 *  gitignored and spells the locale list by construction), else a walk (fixtures). */
function scanFiles(root) {
  const git = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', ...SCAN_ROOTS], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (git.status === 0 && existsSync(join(root, '.git'))) return git.stdout.split('\0').filter(Boolean);
  const out = [];
  const walk = (rel) => {
    for (const e of listDir(join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(child);
      } else out.push(child);
    }
  };
  for (const top of SCAN_ROOTS) if (existsSync(join(root, top))) walk(top);
  return out;
}

// ── rendering ────────────────────────────────────────────────────────────────

const dq = (s) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/** THE GENERATED DART FILE. Deterministic: register order, every field. */
export function renderDartRegister(reg) {
  const row = (r) =>
    [
      '  RegisteredLocale(',
      `    code: ${dq(r.code)},`,
      `    name: ${dq(r.name)},`,
      `    nativeName: ${dq(r.nativeName)},`,
      `    script: ${dq(r.script)},`,
      `    direction: TextDirection.${r.direction},`,
      `    pluralRules: <String>[${r.pluralRules.split(',').map(dq).join(', ')}],`,
      `    supported: ${r.status === 'supported'},`,
      '  ),',
    ].join('\n');
  const pseudo = (p) => {
    const [lang, country] = p.code.split('-');
    return [
      '  PseudoLocale(',
      `    languageCode: ${dq(lang)},`,
      `    countryCode: ${dq(country)},`,
      `    name: ${dq(p.name)},`,
      `    direction: TextDirection.${p.direction},`,
      `    expansion: ${p.expansion},`,
      '  ),',
    ].join('\n');
  };
  const supported = supportedLocales(reg);
  return [
    '// GENERATED by `node tooling/ci/assert-locale-register.mjs --write` from',
    '// tooling/i18n/locales.json, the locale register. NEVER HAND-EDIT: the guard',
    '// fails CI when this file and the register disagree.',
    '//',
    '// Every surface that needs "which languages do we ship" reads this file: the',
    '// Settings language pickers, the parity tests, the pseudo-locale tests.',
    "import 'package:flutter/widgets.dart' show Locale, TextDirection;",
    '',
    '/// One row of the locale register.',
    'class RegisteredLocale {',
    '  /// A register row; only the generated tables below construct one.',
    '  const RegisteredLocale({',
    '    required this.code,',
    '    required this.name,',
    '    required this.nativeName,',
    '    required this.script,',
    '    required this.direction,',
    '    required this.pluralRules,',
    '    required this.supported,',
    '  });',
    '',
    '  /// The language code, as the ARB suffix and [Locale.languageCode] spell it.',
    '  final String code;',
    '',
    '  /// The English name of the language.',
    '  final String name;',
    '',
    '  /// The name in its own script: what the language picker shows, so a',
    '  /// speaker finds their language without reading the current one.',
    '  final String nativeName;',
    '',
    '  /// The ISO 15924 script code.',
    '  final String script;',
    '',
    '  /// The layout direction the language reads in.',
    '  final TextDirection direction;',
    '',
    '  /// The CLDR cardinal plural categories the language uses.',
    '  final List<String> pluralRules;',
    '',
    '  /// True when every surface ships it; false while it is registered only.',
    '  final bool supported;',
    '',
    '  /// The [Locale] for [code].',
    '  Locale get locale => Locale(code);',
    '}',
    '',
    '/// A test-only pseudo-locale: never shipped, never offered by a picker.',
    'class PseudoLocale {',
    '  /// A register pseudo row; only the generated table below constructs one.',
    '  const PseudoLocale({',
    '    required this.languageCode,',
    '    required this.countryCode,',
    '    required this.name,',
    '    required this.direction,',
    '    required this.expansion,',
    '  });',
    '',
    '  /// The language half of the tag (`en` of `en-XA`).',
    '  final String languageCode;',
    '',
    '  /// The private-use region half of the tag (`XA` of `en-XA`).',
    '  final String countryCode;',
    '',
    '  /// What the pseudo-locale is for.',
    '  final String name;',
    '',
    '  /// The layout direction the pseudo text is laid out in.',
    '  final TextDirection direction;',
    '',
    '  /// How much longer than English the pseudo text is (0.4 = 40%).',
    '  final double expansion;',
    '',
    '  /// The [Locale] for this pseudo-locale.',
    '  Locale get locale => Locale(languageCode, countryCode);',
    '}',
    '',
    '/// Every registered locale, supported or pending, in register order.',
    'const List<RegisteredLocale> kRegisteredLocales = <RegisteredLocale>[',
    ...reg.locales.map(row),
    '];',
    '',
    '/// The locales every surface ships, in register order.',
    'const List<RegisteredLocale> kSupportedLocales = <RegisteredLocale>[',
    ...supported.map(row),
    '];',
    '',
    '/// The codes of [kSupportedLocales], in register order.',
    `const List<String> kSupportedLocaleCodes = <String>[${supported.map((r) => dq(r.code)).join(', ')}];`,
    '',
    '/// The template language: the ARB every other locale is checked against.',
    `const String kSourceLocaleCode = ${dq(reg.source)};`,
    '',
    '/// The test-only pseudo-locales.',
    'const List<PseudoLocale> kPseudoLocales = <PseudoLocale>[',
    ...(reg.pseudo ?? []).map(pseudo),
    '];',
    '',
  ].join('\n');
}

export const CHASSIS_ARB = 'packages/design_system/lib/src/l10n/chassis_en.arb';
export const FORWARDING = 'lib/l10n/chassis_keys.g.dart';
/** The l10n.yaml line that makes gen-l10n's output export [FORWARDING], so every
 *  file importing app_localizations.dart reads a chassis key through `l10n`. */
export const FORWARDING_HEADER = `header: "export 'chassis_keys.g.dart';"`;

/** One Dart member, laid out as `dart format` lays it out (80 columns): on one
 *  line when it fits, else broken after `=>`. */
function member(signature, body) {
  const one = `  ${signature} => ${body};`;
  return one.length <= 80 ? one : `  ${signature} =>\n      ${body};`;
}

/** THE GENERATED CHASSIS FORWARDING for one app: an extension on the app's
 *  AppLocalizations answering every chassis key the app ARB does not declare,
 *  from ChassisLocalizations. So the app READS THE CHASSIS KEY (one translation,
 *  one fix for every app) while its 400-odd `l10n.<key>` call sites stay as they
 *  are. Refuses a placeholder with no declared type: the signature must be the
 *  one gen-l10n generated, or the forwarding call does not compile. */
export function renderChassisForwarding(chassisArb, appKeys) {
  const keys = Object.keys(chassisArb).filter((k) => !k.startsWith('@') && !appKeys.has(k));
  const lines = [
    '// GENERATED by `node tooling/ci/assert-locale-register.mjs --write` from',
    `// ${CHASSIS_ARB} and this app's app_en.arb. NEVER HAND-EDIT: the guard`,
    '// fails CI when this file and the two ARBs disagree.',
    '//',
    "// Every chassis key this app's ARB does not declare, readable through the",
    "// app's own `AppLocalizations` — so a call site reads `l10n.settingsTitle`",
    '// and gets the CHASSIS value: one translation, one fix, for every app.',
    "// app_localizations.dart exports this file (l10n.yaml `header`).",
    "import 'package:flutter/widgets.dart' show Locale;",
    "import 'package:nikatru_design_system/nikatru_design_system.dart';",
    '',
    "import 'app_localizations.dart';",
    '',
    '/// The chassis keys, read through the app\'s own catalogue.',
    'extension ChassisKeys on AppLocalizations {',
    '  ChassisLocalizations get _chassis => this is ChassisLocalizations',
    '      ? this as ChassisLocalizations',
    '      : lookupChassisLocalizations(Locale(localeName));',
  ];
  for (const k of keys) {
    const ph = chassisArb[`@${k}`]?.placeholders ?? {};
    const params = Object.entries(ph).map(([name, def]) => {
      if (typeof def?.type !== 'string') throw new Error(`${CHASSIS_ARB} @${k}.placeholders.${name} declares no type`);
      return [def.type, name];
    });
    lines.push('');
    lines.push(`  /// [ChassisLocalizations.${k}].`);
    if (params.length === 0) {
      lines.push(member(`String get ${k}`, `_chassis.${k}`));
    } else {
      const sig = `String ${k}(${params.map(([t, n]) => `${t} ${n}`).join(', ')})`;
      const call = `_chassis.${k}(${params.map(([, n]) => n).join(', ')})`;
      const one = `  ${sig} => ${call};`;
      if (one.length <= 80) lines.push(one);
      else if (`  ${sig} =>`.length <= 80 && `      ${call};`.length <= 80) lines.push(`  ${sig} =>\n      ${call};`);
      else {
        lines.push(`  String ${k}(`);
        for (const [t, n] of params) lines.push(`    ${t} ${n},`);
        lines.push(`  ) => ${call};`);
      }
    }
  }
  lines.push('}', '');
  return lines.join('\n');
}

/** THE GENERATED ANDROID PER-APP LANGUAGE LIST. */
export function renderLocalesConfig(reg) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- GENERATED by tooling/ci/assert-locale-register.mjs (its write flag) from',
    '     tooling/i18n/locales.json. NEVER HAND-EDIT: the guard fails CI when this',
    '     file and the register disagree. Android 13+ lists these languages in the',
    '     system per-app language setting (android:localeConfig in the manifest). -->',
    '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">',
    ...supportedLocales(reg).map((r) => `    <locale android:name="${r.android}"/>`),
    '</locale-config>',
    '',
  ].join('\n');
}

// ── reading ──────────────────────────────────────────────────────────────────

/** The CFBundleLocalizations array of an Info.plist, or null when absent. */
export function plistLocalizations(text) {
  const m = text.match(/<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!m) return null;
  return [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1].trim());
}

/** The msix_config `languages:` value of a pubspec, split, or null when absent. */
export function msixLanguages(text) {
  const block = text.match(/^msix_config:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m);
  if (!block) return null;
  const m = block[1].match(/^[ \t]+languages:[ \t]*([^\n#]*)/m);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

/** Strip comments so prose naming two languages is not read as a list. */
export function stripComments(text, file) {
  if (/\.(ya?ml|sh)$/.test(file)) return text.replace(/(^|\s)#.*$/gm, '$1');
  if (/\.(xml|plist)$/.test(file)) return text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  if (/\.json$/.test(file)) return text;
  // C-family: block comments (newlines kept, so line numbers hold) then line comments
  // that are not inside a quoted string on that line (a URL's `//` is).
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  return noBlock
    .split('\n')
    .map((line) => {
      let q = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
          if (c === '\\') i++;
          else if (c === q) q = null;
        } else if (c === "'" || c === '"' || c === '`') q = c;
        else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** The `[` span each offset of [text] sits in (innermost), string contents skipped:
 *  an array of span ids, -1 outside any list. */
function listSpans(text) {
  const span = new Int32Array(text.length).fill(-1);
  const stack = [];
  let next = 0;
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    span[i] = stack.length ? stack.at(-1) : -1;
    if (q) {
      if (c === '\\') {
        i++;
        if (i < text.length) span[i] = span[i - 1];
      } else if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') q = c;
    else if (c === '[') stack.push(next++);
    else if (c === ']') stack.pop();
  }
  return span;
}

/** L6 — every hand-typed locale list in [text]: two or more distinct register codes
 *  as quoted elements of ONE list literal (`[...]`; a map keyed per locale is test
 *  data, not a list of what ships), or — in YAML and shell, which spell a list as
 *  adjacent lines or words — as adjacent generated-file names. */
export function handTypedLists(text, file, codes) {
  const C = codes.map((c) => c.replace(/[^a-z]/g, '')).join('|');
  // JSON has one quote character, and a code quoted INSIDE a JSON string is prose
  // (escaped, or in backticks), so only a whole JSON string value counts there.
  const q = /\.json$/.test(file) ? '(?<!\\\\)(")' : `(['"\`])`;
  const quoted = new RegExp(`${q}(?:(${C})|\\w*_(${C})\\.(?:arb|dart))\\1|Locale\\((['"])(${C})\\4\\)`, 'g');
  const bare = new RegExp(`\\b\\w+_(${C})\\.(?:arb|dart)\\b`, 'g');
  const shellish = /\.(ya?ml|sh)$/.test(file);
  const stripped = stripComments(text, file);
  const lineAt = (off) => stripped.slice(0, off).split('\n').length;
  const out = [];
  const report = (group) => {
    const distinct = [...new Set(group.map((t) => t.code))];
    if (distinct.length >= 2) out.push({ from: group[0].line, to: group.at(-1).line, codes: distinct });
  };
  if (shellish) {
    const tokens = [];
    for (const m of stripped.matchAll(bare)) tokens.push({ line: lineAt(m.index), code: m[1] });
    for (const m of stripped.matchAll(quoted)) tokens.push({ line: lineAt(m.index), code: m[2] ?? m[3] ?? m[5] });
    tokens.sort((x, y) => x.line - y.line);
    let run = [];
    for (const t of tokens) {
      if (run.length && t.line - run.at(-1).line > 1) {
        report(run);
        run = [];
      }
      run.push(t);
    }
    report(run);
    return out;
  }
  const span = listSpans(stripped);
  const bySpan = new Map();
  for (const m of stripped.matchAll(quoted)) {
    const id = span[m.index];
    if (id < 0) continue;
    if (!bySpan.has(id)) bySpan.set(id, []);
    bySpan.get(id).push({ line: lineAt(m.index), code: m[2] ?? m[3] ?? m[5] });
  }
  // Within one span, a list is ADJACENT elements: a raw string or a regex holding
  // a bracket can leave a span open for a thousand lines, and two codes that far
  // apart are two sentences, not one list.
  for (const group of bySpan.values()) {
    let run = [];
    for (const t of group) {
      if (run.length && t.line - run.at(-1).line > 2) {
        report(run);
        run = [];
      }
      run.push(t);
    }
    report(run);
  }
  return out.sort((x, y) => x.from - y.from);
}

const exempt = (rel) => EXEMPT.find((e) => (e.path ? e.path === rel : rel.startsWith(e.prefix)));

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ── L8 · right-to-left readiness ─────────────────────────────────────────────

/** The argument list of the call whose `(` is at [open] in [text], split at
 *  top-level commas, plus the offset after its `)`. Strings and nesting aware. */
export function callArgs(text, open) {
  const args = [];
  let depth = 0;
  let q = null;
  let start = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') q = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        args.push(text.slice(start, i));
        return { args: args.map((a) => a.trim()).filter((a, n, all) => a !== '' || n < all.length - 1), end: i + 1 };
      }
    } else if (c === ',' && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return { args, end: text.length };
}

/** Every layout call in Dart [text] that is hard-wired left-to-right: it lays out
 *  the same in Arabic or Hebrew, so the screen reads mirrored-wrong. Comments are
 *  stripped first. Direction-NEUTRAL forms pass: a symmetric fromLTRB, a
 *  Positioned or EdgeInsets.only pinned to BOTH sides with one value, and a
 *  gradient's begin/end (decoration, not reading order). */
export function ltrOnlyCalls(text, file = 'x.dart') {
  const src = stripComments(text, file);
  const lineAt = (off) => src.slice(0, off).split('\n').length;
  const out = [];
  const named = (args) => Object.fromEntries(args.map((a) => a.match(/^(\w+)\s*:\s*([\s\S]*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  const sides = (args) => {
    const n = named(args);
    return 'left' in n || 'right' in n ? ('left' in n && 'right' in n && n.left === n.right ? null : n) : null;
  };
  for (const m of src.matchAll(/\bEdgeInsets\.fromLTRB\s*\(/g)) {
    const { args } = callArgs(src, m.index + m[0].length - 1);
    if (args.length >= 3 && args[0] !== args[2]) out.push({ line: lineAt(m.index), what: `EdgeInsets.fromLTRB(${args[0]}, …, ${args[2]}, …) — use EdgeInsetsDirectional.fromSTEB` });
  }
  for (const m of src.matchAll(/\bEdgeInsets\.only\s*\(/g)) {
    const { args } = callArgs(src, m.index + m[0].length - 1);
    if (sides(args)) out.push({ line: lineAt(m.index), what: 'EdgeInsets.only(left:/right:) — use EdgeInsetsDirectional.only(start:/end:)' });
  }
  for (const m of src.matchAll(/\bPositioned\s*\(/g)) {
    const { args } = callArgs(src, m.index + m[0].length - 1);
    if (sides(args)) out.push({ line: lineAt(m.index), what: 'Positioned(left:/right:) — use PositionedDirectional(start:/end:)' });
  }
  for (const m of src.matchAll(/(\w+\s*:\s*)?(?:[^\n;:]*\?\s*)?\bAlignment\.(center|top|bottom)(Left|Right)\b/g)) {
    if (/^(begin|end)\s*:/.test(m[1] ?? '')) continue;
    out.push({ line: lineAt(m.index), what: `Alignment.${m[2]}${m[3]} — use AlignmentDirectional.${m[2]}${m[3] === 'Left' ? 'Start' : 'End'}` });
  }
  for (const m of src.matchAll(/\bTextAlign\.(left|right)\b/g)) {
    out.push({ line: lineAt(m.index), what: `TextAlign.${m[1]} — use TextAlign.${m[1] === 'left' ? 'start' : 'end'}` });
  }
  return out.sort((a, b) => a.line - b.line);
}

// ── main ─────────────────────────────────────────────────────────────────────

export function main(args) {
  const write = args.includes('--write');
  const rootArg = args.indexOf('--root');
  const root = rootArg >= 0 ? resolve(args[rootArg + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
  const problems = [];
  const oks = [];
  const lost = (why) => {
    console.error(`✗ assert-locale-register: COVERAGE LOST — ${why}`);
    process.exitCode = 2;
    return 2;
  };
  // A limb that could not look is reported AFTER every finding, and exits 2 only
  // when there is none: a finding (exit 1) is never hidden behind a could-not-look.
  const deferred = [];

  // L1
  const raw = read(REGISTER_REL);
  if (raw === null) return lost(`${REGISTER_REL} is absent: there is no list for any surface to read.`);
  let reg;
  try {
    reg = JSON.parse(raw);
  } catch (e) {
    console.error(`✗ ${REGISTER_REL} is not valid JSON: ${e.message}`);
    return 1;
  }
  const regProblems = registerProblems(reg);
  if (regProblems.length) {
    console.error(`✗ ${REGISTER_REL} is malformed:`);
    for (const p of regProblems) console.error(`    ${p}`);
    return 1;
  }
  const supported = supportedLocales(reg);
  const codes = supported.map((r) => r.code);
  const allCodes = reg.locales.map((r) => r.code);
  oks.push(`L1 register: ${reg.locales.length} locale(s), ${codes.length} supported (${codes.join(', ')}), ${(reg.pseudo ?? []).length} pseudo`);

  // Apps are discovered: every apps/<id>/ with a pubspec.
  const apps = existsSync(join(root, 'apps'))
    ? listDir(join(root, 'apps')).filter((d) => existsSync(join(root, 'apps', d, 'pubspec.yaml'))).sort()
    : [];
  if (apps.length === 0) return lost('no apps/<id>/pubspec.yaml found — nothing to hold to the register.');

  // L2
  const generated = [[DART_REGISTER, renderDartRegister(reg)]];
  for (const app of apps) {
    if (existsSync(join(root, 'apps', app, 'android', 'app', 'src', 'main'))) {
      generated.push([`apps/${app}/${LOCALES_CONFIG}`, renderLocalesConfig(reg)]);
    }
  }
  // The chassis forwarding, for every app whose l10n.yaml exports it.
  const chassisArbRaw = read(CHASSIS_ARB);
  const chassisArb = chassisArbRaw === null ? null : JSON.parse(chassisArbRaw);
  for (const app of apps) {
    const yaml = read(`apps/${app}/l10n.yaml`) ?? '';
    if (!yaml.includes(FORWARDING_HEADER)) continue;
    if (chassisArb === null) {
      problems.push(`L2 apps/${app}/l10n.yaml exports the chassis forwarding but ${CHASSIS_ARB} is missing.`);
      continue;
    }
    const appArb = JSON.parse(read(`apps/${app}/lib/l10n/app_en.arb`) ?? '{}');
    generated.push([`apps/${app}/${FORWARDING}`, renderChassisForwarding(chassisArb, new Set(Object.keys(appArb)))]);
  }
  let authCopy = null;
  try {
    authCopy = JSON.parse(read(AUTH_MAIL_COPY_REL) ?? 'null');
  } catch (e) {
    problems.push(`L7 ${AUTH_MAIL_COPY_REL} is not valid JSON: ${e.message}`);
  }
  if (authCopy === null) return lost(`${AUTH_MAIL_COPY_REL} is absent — the auth e-mails have no copy to render.`);
  const authGaps = authMailCopyProblems(reg, authCopy);
  if (authGaps.length === 0) {
    for (const [file, text] of renderAuthMail(reg, authCopy)) {
      for (const dir of AUTH_MAIL_OUT_DIRS) generated.push([`${dir}/${file}`, text]);
    }
  }
  for (const [rel, want] of generated) {
    const have = read(rel);
    if (have === want) continue;
    if (write) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), want);
      console.log(`wrote ${rel}`);
    } else {
      problems.push(`L2 ${rel} ${have === null ? 'is missing' : 'is not what the register renders'} — run \`node tooling/ci/assert-locale-register.mjs --write\`.`);
    }
  }
  oks.push(`L2 generated: ${generated.length} file(s) rendered from the register`);

  // L3
  const arbDirs = [
    ...apps.filter((a) => existsSync(join(root, 'apps', a, 'lib', 'l10n'))).map((a) => ({ dir: `apps/${a}/lib/l10n`, prefix: 'app' })),
    ...FIXED_ARB_DIRS,
  ];
  let arbDirsRead = 0;
  for (const { dir, prefix } of arbDirs) {
    if (!existsSync(join(root, dir))) {
      problems.push(`L3 ${dir} is missing — an ARB directory this guard holds to the register.`);
      continue;
    }
    arbDirsRead++;
    const re = new RegExp(`^${prefix}_([A-Za-z_]+)\\.arb$`);
    const have = listDir(join(root, dir))
      .map((f) => f.match(re)?.[1])
      .filter(Boolean);
    for (const c of codes) {
      if (!have.includes(c)) {
        problems.push(
          `L3 ${dir}/${prefix}_${c}.arb is missing. "${c}" is a supported locale, so this surface renders ENGLISH for it — ` +
            'the dead-control defect the register exists to stop.',
        );
      }
    }
    for (const c of have) {
      if (!codes.includes(c)) {
        problems.push(
          `L3 ${dir}/${prefix}_${c}.arb ships a language the register does not list as supported. ` +
            `Add a row to ${REGISTER_REL} (status supported) or delete the file.`,
        );
      }
    }
  }
  oks.push(`L3 arb sets: ${arbDirsRead} ARB director(y/ies) each hold exactly the supported set`);

  // L9 — no app or brick ARB redeclares a chassis key: the second copy is a
  // second translation to pay for and a second wording to drift.
  if (chassisArb !== null) {
    const chassisKeys = new Set(Object.keys(chassisArb).filter((k) => !k.startsWith('@')));
    let appKeysRead = 0;
    for (const { dir, prefix } of arbDirs) {
      if (prefix !== 'app') continue;
      const enRaw = read(`${dir}/app_en.arb`);
      if (enRaw === null) continue;
      const keys = Object.keys(JSON.parse(enRaw)).filter((k) => !k.startsWith('@'));
      appKeysRead += keys.length;
      const dup = keys.filter((k) => chassisKeys.has(k));
      if (dup.length) {
        problems.push(
          `L9 ${dir}/app_en.arb redeclares ${dup.length} chassis key(s) (${dup.slice(0, 8).join(', ')}${dup.length > 8 ? ', …' : ''}). ` +
            `Delete them from every app_<locale>.arb (node tooling/i18n/arb-remove-keys.mjs ${dir} app <keys>) and read the ` +
            'chassis key: through context.chassisL10n, or through l10n where the app exports chassis_keys.g.dart.',
        );
      }
    }
    oks.push(`L9 dedupe: ${appKeysRead} app/brick message key(s), none redeclaring one of ${chassisKeys.size} chassis key(s)`);
  }

  // L4
  let nativeGraded = 0;
  const apple = supported.map((r) => r.apple);
  const msix = supported.map((r) => r.msix);
  for (const app of apps) {
    for (const plat of ['ios', 'macos']) {
      const rel = `apps/${app}/${plat}/Runner/Info.plist`;
      const text = read(rel);
      if (text === null) continue;
      nativeGraded++;
      const got = plistLocalizations(text);
      if (got === null) problems.push(`L4 ${rel} has no CFBundleLocalizations — the store lists the app as English only and the OS does not report the device language. Want [${apple.join(', ')}].`);
      else if (!sameList(got, apple)) problems.push(`L4 ${rel} CFBundleLocalizations is [${got.join(', ')}], the register says [${apple.join(', ')}].`);
    }
    const manifestRel = `apps/${app}/android/app/src/main/AndroidManifest.xml`;
    const manifest = read(manifestRel);
    if (manifest !== null) {
      nativeGraded++;
      if (!/<application\b[^>]*\sandroid:localeConfig="@xml\/locales_config"/.test(manifest)) {
        problems.push(`L4 ${manifestRel} <application> has no android:localeConfig="@xml/locales_config" — Android 13+ offers no per-app language.`);
      }
    }
    const pubRel = `apps/${app}/pubspec.yaml`;
    const langs = msixLanguages(read(pubRel) ?? '');
    if (langs !== null) {
      nativeGraded++;
      if (!sameList(langs, msix)) problems.push(`L4 ${pubRel} msix_config languages is "${langs.join(',')}", the register says "${msix.join(',')}" — the Store offers a listing only in a language the package declares.`);
    }
  }
  if (nativeGraded === 0) deferred.push('no app has an Info.plist, an AndroidManifest.xml or an msix_config to grade — L4 checked nothing.');
  oks.push(`L4 native: ${nativeGraded} declaration(s) across ${apps.length} app(s) match the register`);

  // L5
  for (const r of READERS) {
    const text = read(r.file);
    if (text === null) problems.push(`L5 ${r.file} is missing — it is a named reader of the register (${r.why}).`);
    else if (!r.must.test(text)) problems.push(`L5 ${r.file} no longer reads the register: ${r.why}. Expected ${r.must}.`);
  }
  oks.push(`L5 readers: ${READERS.length} named file(s) read the register`);

  // L7
  for (const g of authGaps) problems.push(`L7 ${AUTH_MAIL_COPY_REL} ${g}`);
  const digestRaw = read(DIGEST_COPY);
  if (digestRaw === null) return lost(`${DIGEST_COPY} is absent — the renewal digest has no copy table to hold to the register.`);
  let digest = {};
  try {
    digest = JSON.parse(digestRaw);
  } catch (e) {
    problems.push(`L7 ${DIGEST_COPY} is not valid JSON: ${e.message}`);
  }
  const digestLocales = Object.keys(digest).filter((k) => !k.startsWith('$'));
  const enKeys = Object.keys(digest[reg.source] ?? {});
  for (const c of codes) {
    if (!(c in digest)) {
      problems.push(`L7 ${DIGEST_COPY} has no "${c}" block — a person whose stored locale is ${c} gets the digest in English.`);
      continue;
    }
    const gaps = enKeys.filter((k) => !(k in digest[c]));
    if (gaps.length) problems.push(`L7 ${DIGEST_COPY} "${c}" lacks ${gaps.join(', ')}.`);
  }
  for (const c of digestLocales) if (!codes.includes(c)) problems.push(`L7 ${DIGEST_COPY} has a "${c}" block, which the register does not list as supported.`);
  oks.push(`L7 copy: the digest and the ${authCopy?.templates ? Object.keys(authCopy.templates).length : 0} auth e-mail(s) speak exactly the supported set`);

  // L6 (and L8, over the same listing)
  let scanned = 0;
  const reached = new Set();
  const lists = [];
  const ltr = [];
  const rtlTrees = new Map(RTL_TREES.map((t) => [t, 0]));
  for (const rel of scanFiles(root)) {
    if (!existsSync(join(root, rel))) continue;
    const tree = RTL_TREES.find((t) => new RegExp(`^${t}`).test(rel));
    if (tree && rel.endsWith('.dart') && !rel.endsWith('.g.dart')) {
      rtlTrees.set(tree, rtlTrees.get(tree) + 1);
      for (const hit of ltrOnlyCalls(readFileSync(join(root, rel), 'utf8'), rel)) ltr.push({ rel, ...hit });
    }
    if (!SCAN_EXT.test(rel) || exempt(rel)) continue;
    scanned++;
    reached.add(rel);
    for (const hit of handTypedLists(readFileSync(join(root, rel), 'utf8'), rel, allCodes)) lists.push({ rel, ...hit });
  }
  // The reach check: every named reader is a file that once held a hand-typed list,
  // so a scan that no longer reaches all of them is not evidence of anything.
  const unreached = READERS.map((r) => r.file).filter((f) => !reached.has(f));
  if (unreached.length) deferred.push(`the hand-typed-list scan did not reach ${unreached.join(', ')} — files that once held a typed locale list.`);
  for (const l of lists) {
    problems.push(
      `L6 ${l.rel}:${l.from}${l.to !== l.from ? `-${l.to}` : ''} types the locale list [${l.codes.join(', ')}] by hand. ` +
        `Read it from the register instead — Dart: kSupportedLocaleCodes / kSupportedLocales (nikatru_design_system); ` +
        `Node: tooling/i18n/locales.mjs; shell: \`node tooling/i18n/locales.mjs --codes\`.`,
    );
  }
  oks.push(`L6 hand-typed: ${scanned} file(s) scanned, ${EXEMPT.length} named exemption(s), no locale list outside the register`);

  // L8
  const empty = [...rtlTrees].filter(([, n]) => n === 0).map(([t]) => t);
  if (empty.length) deferred.push(`the right-to-left scan read no Dart file under ${empty.join(', ')} — a tree it exists to hold.`);
  for (const h of ltr) {
    problems.push(`L8 ${h.rel}:${h.line} ${h.what}. It lays out the same in a right-to-left language, so the screen reads mirrored-wrong.`);
  }
  oks.push(`L8 right-to-left: ${[...rtlTrees.values()].reduce((a, b) => a + b, 0)} Dart file(s) in ${rtlTrees.size} UI tree(s), no hard-wired left/right layout`);

  if (problems.length) {
    console.error(`✗ assert-locale-register — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    for (const d of deferred) console.error(`    (and COVERAGE LOST — ${d})`);
    return 1;
  }
  if (deferred.length) {
    for (const d of deferred) lost(d);
    return 2;
  }
  for (const o of oks) console.log(`ok   ${o}`);
  console.log('assert-locale-register: ok — every surface reads the one locale register');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`✗ assert-locale-register crashed: ${e.stack ?? e}`);
    process.exit(1);
  }
}
