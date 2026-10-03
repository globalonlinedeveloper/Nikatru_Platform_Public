#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-locale-register.mjs — every surface that names the set of languages
// READS tooling/i18n/locales.json; none of them types it.
//
// Register row: O-LOCALES-HAND-TYPED-IN-12-PLACES (lane i18n-pipeline). The set
// "en, ta, hi" was typed by hand in at least twelve places — tests, both
// Settings pickers, ci.yml, store and content tooling, native manifests — and
// two had already drifted: the brick shipped en+ta while the chassis picker
// offered Hindi (so every new app's Hindi tile rendered English), and the
// privacy-notice duty (K-14) derived its locales from the brick, so Hindi was
// invisible to it. Each copy was right the day it was typed; nothing made the
// next language reach all of them.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
//   L1 register   tooling/i18n/locales.json is well formed (locales.mjs
//                 `validateRegister`): tags, direction, CLDR plural set, status,
//                 one supported source locale, pseudo tags that collide with none.
//   L2 arb        every gen-l10n root (each apps/*/l10n.yaml, every package's,
//                 the brick's) carries EXACTLY one ARB per supported locale — a
//                 missing one is a picker tile that renders the template
//                 language, an extra one is a language no picker offers.
//   L3 generated  the Dart table and every app's native declarations (iOS/macOS
//                 CFBundleLocalizations, Android locales_config.xml +
//                 android:localeConfig, MSIX `languages:`) are what the register
//                 renders (`node tooling/i18n/locales.mjs --write`), and the three
//                 auth-mail templates are what tooling/i18n/auth-mail.mjs renders.
//   L4 typed      no tracked source file holds a hand-typed list of two or more
//                 register locales — `'en', 'ta'`, `Locale('ta'), Locale('hi')`,
//                 `x_ta.dart x_hi.dart` — unless a `locale-list:` note on that
//                 line or the three above says why it is NOT the set (a fixture,
//                 a deliberate sample). The marker is the escape hatch, and it
//                 has to carry a reason a reviewer can read.
//   L5 readers    each consumer named in READERS still reads the register (a
//                 consumer quietly re-typing its list passes L4 only if it uses a
//                 shape L4 does not know; L5 pins the known ones by name).
//
// Exit 0 = green. 1 = a finding. 2 = COVERAGE LOST: fewer gen-l10n roots than
// the floor were found, or the L4 scan read fewer files than its floor — either
// way the guard checked too little to be evidence.
//
// Usage: node tooling/ci/assert-locale-register.mjs [--root <dir>]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { repoGit } from '../scripts/repo-git.mjs';
import { REGISTER, DART_TABLE, validateRegister, supportedCodes, arbSuffix, plan } from '../i18n/locales.mjs';
import { plan as authMailPlan, MESSAGES } from '../i18n/auth-mail.mjs';

export const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
/** gen-l10n roots the tree must have at least: the chassis, the brick and one app. */
export const MIN_L10N_ROOTS = 3;
/** L4 must read at least this many source files, or it scanned nothing real. */
export const MIN_SCANNED = 200;
export const MARKER = 'locale-list:';
const SCAN_EXT = /\.(dart|mjs|cjs|js|ts|yml|yaml|sh|ps1)$/;
/** Paths L4 does not read, each with its reason. */
export const SCAN_EXCLUDED = [
  { re: /^tooling\/i18n\//, why: 'the register and its renderer ARE the derivation' },
  { re: new RegExp(`^${DART_TABLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), why: 'generated from the register' },
  { re: /^extensions\//, why: 'the browser-extension factory: Chrome `_locales` catalogues with their own TM pipeline (make-locales.mjs) and 55 locales, not the app register' },
  { re: /(^|\/)node_modules\//, why: 'third-party' },
  { re: /^tooling\/ci\/test\/fixtures\//, why: 'frozen guard fixtures' },
  { re: /^tooling\/ci\/(assert-locale-register\.mjs|test\/locale-register\.test\.mjs)$/, why: 'this matcher and its own red fixtures' },
];

/** Consumers that must read the register, by file. */
export const READERS = [
  { file: 'apps/subscriptiontracker/lib/features/settings/settings_screen.dart', must: /kSupportedLocales/, why: 'the app Settings picker offers the register' },
  { file: 'packages/chassis_screens/lib/settings/settings_screen.dart', must: /kSupportedLocales/, why: 'the chassis Settings picker offers the register' },
  { file: 'tooling/ci/assert-policy-archive.mjs', must: /i18n\/locales\.mjs/, why: 'the per-locale privacy-notice duty (K-14) is the register\'s supported set, not the brick\'s ARB folder' },
  { file: 'tooling/ci/assert-stamp-text-fidelity.mjs', must: /i18n\/locales\.mjs/, why: 'every stamped ARB carries the display name' },
  { file: 'tooling/content_pipeline/examples/service-catalogue/make-recipe.mjs', must: /i18n\/locales\.mjs/, why: 'the content pack ships one shard per supported locale' },
  { file: 'tooling/bricks/app/hooks/post_gen.dart', must: /tooling\/i18n\/locales\.json/, why: 'a stamped app\'s MSIX languages come from the register' },
  { file: 'services/platform/src/lib/digest-copy.ts', must: /tooling\/i18n\/messages\/email\.json[\s\S]*tooling\/i18n\/locales\.json/, why: 'the renewal digest speaks the stored locale, from the register\'s copy' },
  { file: 'services/platform/src/lib/reminders.ts', must: /readStoredLocale\(/, why: 'the digest reads the person\'s stored locale before it is built' },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The L4 matcher for a code set: two adjacent locale tokens with different codes. */
export function typedListMatcher(codes) {
  const C = codes.map((c) => esc(c)).sort((a, b) => b.length - a.length).join('|');
  const C_ = codes.map((c) => esc(arbSuffix(c))).sort((a, b) => b.length - a.length).join('|');
  const token =
    `(?:(['"\`])(${C})\\1` + // 'ta'
    `|(?:const\\s+)?Locale\\(\\s*'(${C})'\\s*\\)` + // Locale('ta')
    `|['"]?[\\w.{}-]*_(${C_})\\.(?:arb|dart)['"]?)`; // app_ta.arb, x_ta.dart
  return { token: new RegExp(token, 'g'), sep: /^[\s,\\]*$/ };
}

/** Every hand-typed locale list in `text`, as {line, snippet}. */
export function findTypedLists(text, codes) {
  const { token, sep } = typedListMatcher(codes);
  const toks = [];
  for (const m of text.matchAll(token)) {
    const code = m[2] ?? m[3] ?? m[4];
    toks.push({ start: m.index, end: m.index + m[0].length, code: code.replace(/_/g, '-') });
  }
  const hits = [];
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    if (a.code === b.code) continue;
    if (!sep.test(text.slice(a.end, b.start))) continue;
    const line = text.slice(0, a.start).split('\n').length;
    if (hits.length && hits[hits.length - 1].line === line) continue;
    hits.push({ line, start: a.start });
  }
  const lines = text.split('\n');
  return hits
    .filter((h) => !lines.slice(Math.max(0, h.line - 4), h.line).some((l) => l.includes(MARKER)))
    .map((h) => ({ line: h.line, snippet: lines[h.line - 1].trim().slice(0, 120) }));
}

/** gen-l10n roots: {dir, arbDir, prefix} for each l10n.yaml. */
export function l10nRoots(root) {
  const dirs = [];
  for (const parent of ['apps', 'packages']) {
    const abs = join(root, parent);
    if (!existsSync(abs)) continue;
    for (const e of listDir(abs, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(abs, e.name, 'l10n.yaml'))) dirs.push(`${parent}/${e.name}`);
    }
  }
  if (existsSync(join(root, BRICK_APP, 'l10n.yaml'))) dirs.push(BRICK_APP);
  return dirs.map((dir) => {
    const y = readFileSync(join(root, dir, 'l10n.yaml'), 'utf8');
    const arbDir = (y.match(/^arb-dir:\s*(\S+)/m) ?? [])[1] ?? 'lib/l10n';
    const template = (y.match(/^template-arb-file:\s*(\S+)/m) ?? [])[1] ?? 'app_en.arb';
    const prefix = template.replace(/_[A-Za-z]+\.arb$/, '');
    return { dir, arbDir, prefix, template };
  });
}

export function check(root, { minScanned = MIN_SCANNED } = {}) {
  const findings = [];
  const ok = [];
  let coverage = null;

  // L1
  let reg;
  try {
    reg = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  } catch (e) {
    return { findings: [`L1 ${REGISTER} cannot be read: ${e.message}`], ok, coverage };
  }
  const shape = validateRegister(reg);
  if (shape.length) return { findings: shape.map((p) => `L1 ${p}`), ok, coverage };
  const codes = supportedCodes(reg);
  const allCodes = reg.locales.map((r) => r.code);
  ok.push(`L1 register: ${codes.length} supported (${codes.join(', ')}), ${allCodes.length - codes.length} pending, ${(reg.pseudo ?? []).length} pseudo`);

  // L2
  const roots = l10nRoots(root);
  if (roots.length < MIN_L10N_ROOTS) {
    coverage = `L2 found ${roots.length} gen-l10n root(s) (${roots.map((r) => r.dir).join(', ') || 'none'}); the floor is ${MIN_L10N_ROOTS} — the chassis, the brick and at least one app. Fewer means the walk broke, and "every root carries every locale" would be vacuously true.`;
  }
  for (const r of roots) {
    const abs = join(root, r.dir, r.arbDir);
    const have = existsSync(abs)
      ? listDir(abs)
          .map((f) => f.match(new RegExp(`^${esc(r.prefix)}_([A-Za-z0-9_]+)\\.arb$`))?.[1])
          .filter(Boolean)
          .map((s) => s.replace(/_/g, '-'))
      : [];
    const missing = codes.filter((c) => !have.includes(c));
    const extra = have.filter((c) => !codes.includes(c));
    for (const c of missing) {
      findings.push(
        `L2 ${r.dir}/${r.arbDir}/${r.prefix}_${arbSuffix(c)}.arb is missing — "${c}" is supported in ${REGISTER}, so the Settings picker offers it and this root renders ${r.template.replace(/^.*_|\.arb$/g, '')} instead. Add the ARB (tooling/i18n/translation-qa.mjs ${c} lists the keys), or mark the row pending.`,
      );
    }
    for (const c of extra) {
      findings.push(`L2 ${r.dir}/${r.arbDir}/${r.prefix}_${arbSuffix(c)}.arb is a locale ${REGISTER} does not support — no picker offers it. Add a register row, or delete the file.`);
    }
    if (!missing.length && !extra.length) ok.push(`L2 ${r.dir}: one ${r.prefix}_*.arb per supported locale`);
  }

  // L3
  let items = [];
  try {
    items = plan(root, reg);
  } catch (e) {
    findings.push(`L3 the register could not be rendered: ${e.message}`);
  }
  // The three auth-mail templates are rendered from the register too
  // (tooling/i18n/auth-mail.mjs): one branch per supported locale with copy.
  try {
    items = [...items, ...authMailPlan(root).items];
  } catch (e) {
    findings.push(`L3 the auth-mail templates could not be rendered from ${MESSAGES}: ${e.message}`);
  }
  let current = 0;
  for (const it of items) {
    if (it.want === null) findings.push(`L3 ${it.path}: cannot render ${it.note}.`);
    else if (it.want !== it.have) {
      const fix = it.path.startsWith('docs/platform/supabase/') ? 'node tooling/i18n/auth-mail.mjs && node tooling/sites/gen-auth-mail.mjs' : 'node tooling/i18n/locales.mjs --write';
      findings.push(`L3 ${it.path} is not what ${REGISTER} renders — run \`${fix}\` and commit the diff.`);
    }
    else current++;
  }
  if (items.length) ok.push(`L3 ${current}/${items.length} derived file(s) current`);

  // L4
  const files = repoGit(root, 'ls-files', '-z').split('\0').filter((f) => SCAN_EXT.test(f) && !SCAN_EXCLUDED.some((x) => x.re.test(f)));
  let scanned = 0;
  let typed = 0;
  for (const f of files) {
    const abs = join(root, f);
    if (!existsSync(abs)) continue;
    scanned++;
    for (const h of findTypedLists(readFileSync(abs, 'utf8'), allCodes)) {
      typed++;
      findings.push(
        `L4 ${f}:${h.line} types a list of locales by hand: ${h.snippet}\n` +
          `      Read the register instead (Dart: kSupportedLocaleCodes / kTranslationLocaleCodes; node: tooling/i18n/locales.mjs; shell: \`node tooling/i18n/locales.mjs --codes\`), ` +
          `or — if it is deliberately NOT the set (a fixture, a sample) — say so with a \`// ${MARKER} <why>\` note on the line or the three above.`,
      );
    }
  }
  if (scanned < minScanned && !coverage) {
    coverage = `L4 scanned ${scanned} source file(s); the floor is ${minScanned}. A scan that reads almost nothing finds no typed list and proves nothing.`;
  }
  if (!typed) ok.push(`L4 ${scanned} tracked source file(s) scanned, no hand-typed locale list`);

  // L5
  for (const r of READERS) {
    const abs = join(root, r.file);
    if (!existsSync(abs)) {
      findings.push(`L5 ${r.file} is gone — READERS names it because ${r.why}. Update READERS to where that moved.`);
      continue;
    }
    if (!r.must.test(readFileSync(abs, 'utf8'))) findings.push(`L5 ${r.file} no longer reads the register (${r.must}) — ${r.why}.`);
  }
  if (!findings.some((f) => f.startsWith('L5'))) ok.push(`L5 ${READERS.length} consumer(s) read the register`);

  return { findings, ok, coverage };
}

function main(argv) {
  const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { findings, ok, coverage } = check(root);
  if (coverage) {
    console.error(`COVERAGE LOST — ${coverage}`);
    return 2;
  }
  for (const o of ok) console.log(`ok   ${o}`);
  if (findings.length) {
    console.error(`✗ locale register — ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  ${f}`);
    return 1;
  }
  console.log('assert-locale-register: ok — one register, every surface reads it');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
