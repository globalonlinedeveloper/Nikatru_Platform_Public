#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// translation-qa.mjs — what a locale still owes, and a review sheet for it.
// No API calls: it reads files and writes files. [lane i18n-pipeline, item 7]
//
// The owner's lock is that translation is done by the local automation, plus an
// "ARB/ICU placeholder-safety step"; this is that step, and the hand-off around
// it. Given a locale of tooling/i18n/locales.json it reads every gen-l10n root
// (each l10n.yaml: the apps, the chassis, the brick) and the server copy
// (tooling/i18n/messages/email.json), and lists:
//
//   missing      a key the template (English) has and the locale does not
//   extra        a key the locale has and English does not
//   changed      a key whose ENGLISH changed since the locale was last accepted
//                (fingerprints in tooling/i18n/fingerprints/<locale>.json, written
//                by --accept; a key with no fingerprint is "unaccepted")
//   placeholder  a {placeholder} English uses that the translation drops, or one
//                the translation invents (ICU-aware: arm bodies are walked)
//   icu          a plural/select English has and the translation does not (or of
//                another kind), a plural without `other`, a plural missing a
//                category the register's `plural` row requires, or a select
//                whose arms differ from English's
//   identical    a value equal to English (often right — a brand — so info only)
//
// --sheet <file.tsv> writes the REVIEW SHEET: one row per key that needs a human
// (missing, changed, unaccepted, flagged), with the English source, the current
// translation, an empty BACK-TRANSLATION slot, and empty filled_by / checked_by /
// verdict columns — one lane fills the translation and back-translation, a SECOND
// lane checks the pair and writes its verdict. Nothing reads a sheet back
// automatically: the checked translation is applied to the ARB by hand or by the
// automation, and this script is re-run until the locale is clean.
//
// Usage:
//   node tooling/i18n/translation-qa.mjs <locale> [--sheet <out.tsv>] [--json]
//   node tooling/i18n/translation-qa.mjs <locale> --accept   record today's English
//                                                            as the accepted source
//   node tooling/i18n/translation-qa.mjs --all               every supported locale
// Exit 0 = nothing missing, changed or broken. 1 = findings (the work list).
// 2 = COVERAGE LOST (no gen-l10n root found, or an unknown locale).
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegister, supportedCodes, arbSuffix } from './locales.mjs';
import { l10nRoots } from '../ci/assert-locale-register.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FINGERPRINT_DIR = 'tooling/i18n/fingerprints';
export const EMAIL = 'tooling/i18n/messages/email.json';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const readJson = (abs) => JSON.parse(readFileSync(abs, 'utf8'));
const messageKeys = (arb) => Object.keys(arb).filter((k) => !k.startsWith('@'));

/**
 * The ICU structure of a message: the placeholders it REFERENCES (including
 * inside plural/select arms) and its plural/select arguments with their arms.
 */
export function icuShape(msg) {
  const placeholders = new Set();
  const args = new Map(); // name -> { kind, arms:Set }
  const walk = (s) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open === -1) return;
      let depth = 0;
      let close = -1;
      for (let j = open; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}' && --depth === 0) {
          close = j;
          break;
        }
      }
      if (close === -1) return;
      const body = s.slice(open + 1, close);
      const m = body.match(/^\s*(\w+)\s*,\s*(plural|select)\s*,([\s\S]*)$/);
      if (m) {
        placeholders.add(m[1]);
        const arms = new Set();
        let k = 0;
        const rest = m[3];
        while (k < rest.length) {
          const o = rest.indexOf('{', k);
          if (o === -1) break;
          const key = rest.slice(k, o).trim();
          let d = 0;
          let c = -1;
          for (let j = o; j < rest.length; j++) {
            if (rest[j] === '{') d++;
            else if (rest[j] === '}' && --d === 0) {
              c = j;
              break;
            }
          }
          if (c === -1) break;
          arms.add(key);
          walk(rest.slice(o + 1, c));
          k = c + 1;
        }
        args.set(m[1], { kind: m[2], arms });
      } else if (/^\s*\w+\s*$/.test(body)) {
        placeholders.add(body.trim());
      }
      i = close + 1;
    }
  };
  walk(String(msg));
  return { placeholders, args };
}

/** The problems with one translated message against its English source. */
export function compareMessage(en, tr, requiredPlural = []) {
  const out = [];
  const a = icuShape(en);
  const b = icuShape(tr);
  for (const p of a.placeholders) if (!b.placeholders.has(p)) out.push(['placeholder', `drops {${p}}`]);
  for (const p of b.placeholders) if (!a.placeholders.has(p)) out.push(['placeholder', `invents {${p}}`]);
  for (const [name, ea] of a.args) {
    const ta = b.args.get(name);
    if (!ta) {
      out.push(['icu', `English has {${name}, ${ea.kind}} and the translation does not`]);
      continue;
    }
    if (ta.kind !== ea.kind) out.push(['icu', `{${name}} is ${ea.kind} in English and ${ta.kind} here`]);
    if (ea.kind === 'plural') {
      if (!ta.arms.has('other')) out.push(['icu', `{${name}, plural} has no other arm`]);
      const missingCat = requiredPlural.filter((c) => c !== 'other' && !ta.arms.has(c) && !ta.arms.has(`=${c === 'one' ? 1 : c === 'zero' ? 0 : c === 'two' ? 2 : '?'}`));
      if (missingCat.length) out.push(['icu', `{${name}, plural} lacks the ${missingCat.join(', ')} categor${missingCat.length === 1 ? 'y' : 'ies'} this language uses`]);
    } else {
      const ex = [...ea.arms].filter((k) => !ta.arms.has(k));
      const inv = [...ta.arms].filter((k) => !ea.arms.has(k));
      if (ex.length || inv.length) out.push(['icu', `{${name}, select} arms differ (missing: ${ex.join(' ') || '-'}; extra: ${inv.join(' ') || '-'})`]);
    }
  }
  return out;
}

/** Flatten email.json's per-locale blocks into key -> string. */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v && typeof v === 'object') flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

/** Every unit of translatable copy: {surface, en, tr} maps per surface. */
export function surfaces(root, reg, code) {
  const out = [];
  for (const r of l10nRoots(root)) {
    const dir = join(root, r.dir, r.arbDir);
    const enPath = join(dir, r.template);
    if (!existsSync(enPath)) continue;
    const trPath = join(dir, `${r.prefix}_${arbSuffix(code)}.arb`);
    const en = readJson(enPath);
    const tr = existsSync(trPath) ? readJson(trPath) : {};
    out.push({
      surface: `${r.dir}/${r.arbDir}/${r.prefix}_${arbSuffix(code)}.arb`,
      en: Object.fromEntries(messageKeys(en).map((k) => [k, en[k]])),
      tr: Object.fromEntries(messageKeys(tr).map((k) => [k, tr[k]])),
      present: existsSync(trPath),
    });
  }
  if (existsSync(join(root, EMAIL))) {
    const e = readJson(join(root, EMAIL));
    for (const section of ['digest', 'authMail', 'feedbackMail', 'privacyMail']) {
      out.push({
        surface: `${EMAIL}#${section}`,
        en: flatten(e[section]?.[reg.sourceLocale]),
        tr: flatten(e[section]?.[code]),
        present: Boolean(e[section]?.[code]),
      });
    }
  }
  return out;
}

export function qa(root, code) {
  const reg = loadRegister(root);
  const row = reg.locales.find((l) => l.code === code);
  if (!row) return { coverage: `"${code}" is not a row of tooling/i18n/locales.json.` };
  if (code === reg.sourceLocale) return { coverage: `"${code}" is the source locale; there is nothing to translate into it.` };
  const units = surfaces(root, reg, code);
  if (!units.some((u) => u.surface.endsWith('.arb'))) return { coverage: 'no gen-l10n root was found.' };
  const fpPath = join(root, FINGERPRINT_DIR, `${code}.json`);
  const fp = existsSync(fpPath) ? readJson(fpPath) : {};
  const findings = [];
  const rows = [];
  let checked = 0;
  for (const u of units) {
    const accepted = fp[u.surface] ?? {};
    for (const [k, en] of Object.entries(u.en)) {
      checked++;
      const tr = u.tr[k];
      const flags = [];
      if (tr === undefined) flags.push(['missing', 'no translation']);
      else {
        flags.push(...compareMessage(en, tr, row.plural));
        if (accepted[k] === undefined) flags.push(['unaccepted', 'no accepted English fingerprint']);
        else if (accepted[k] !== sha(en)) flags.push(['changed', 'the English changed since this was accepted']);
        if (tr === en && /[A-Za-z]{3}/.test(String(en).replace(/\{[^}]*\}/g, ''))) flags.push(['identical', 'same as English']);
      }
      for (const [kind, why] of flags) if (kind !== 'unaccepted' && kind !== 'identical') findings.push({ surface: u.surface, key: k, kind, why });
      if (flags.length) rows.push({ surface: u.surface, key: k, en, tr: tr ?? '', flags: flags.map(([kind, why]) => `${kind}: ${why}`).join('; ') });
    }
    for (const k of Object.keys(u.tr)) {
      if (!(k in u.en)) findings.push({ surface: u.surface, key: k, kind: 'extra', why: 'English has no such key' });
    }
  }
  return { coverage: null, code, findings, rows, checked, units };
}

/** Record today's English as the accepted source of every key the locale has. */
export function accept(root, code) {
  const reg = loadRegister(root);
  const fp = {};
  for (const u of surfaces(root, reg, code)) {
    fp[u.surface] = Object.fromEntries(Object.keys(u.en).filter((k) => k in u.tr).map((k) => [k, sha(u.en[k])]));
  }
  mkdirSync(join(root, FINGERPRINT_DIR), { recursive: true });
  writeFileSync(join(root, FINGERPRINT_DIR, `${code}.json`), `${JSON.stringify(fp, null, 2)}\n`);
  return fp;
}

const tsv = (s) => String(s).replace(/\t/g, ' ').replace(/\r?\n/g, '\\n');
export function sheet(result) {
  const head = ['surface', 'key', 'source_en', 'translation', 'back_translation', 'flags', 'filled_by', 'checked_by', 'verdict'];
  return [head.join('\t'), ...result.rows.map((r) => [r.surface, r.key, r.en, r.tr, '', r.flags, '', '', ''].map(tsv).join('\t'))].join('\n') + '\n';
}

function main(argv) {
  const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : DEFAULT_ROOT;
  const reg = loadRegister(root);
  const flagArgs = new Set(['--root', '--sheet']);
  const codes = argv.includes('--all')
    ? supportedCodes(reg).filter((c) => c !== reg.sourceLocale)
    : argv.filter((a, i) => !a.startsWith('--') && !flagArgs.has(argv[i - 1]));
  if (!codes.length) {
    console.error('usage: translation-qa.mjs <locale> [--sheet out.tsv] [--accept] [--json] | --all');
    return 2;
  }
  let worst = 0;
  for (const code of codes) {
    if (argv.includes('--accept')) {
      const fp = accept(root, code);
      console.log(`accepted ${code}: ${Object.values(fp).reduce((n, m) => n + Object.keys(m).length, 0)} key(s) fingerprinted in ${FINGERPRINT_DIR}/${code}.json`);
      continue;
    }
    const r = qa(root, code);
    if (r.coverage) {
      console.error(`COVERAGE LOST — ${r.coverage}`);
      worst = 2;
      continue;
    }
    if (argv.includes('--json')) console.log(JSON.stringify({ code, findings: r.findings, checked: r.checked }, null, 2));
    const by = {};
    for (const f of r.findings) by[f.kind] = (by[f.kind] ?? 0) + 1;
    const summary = Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ') || 'clean';
    console.log(`${r.findings.length ? '✗' : 'ok'}  ${code} — ${r.checked} key(s) across ${r.units.length} surface(s): ${summary}; ${r.rows.length} row(s) for review`);
    if (!argv.includes('--json')) for (const f of r.findings.slice(0, 40)) console.log(`    ${f.kind.padEnd(11)} ${f.surface} ${f.key} — ${f.why}`);
    if (r.findings.length > 40) console.log(`    … and ${r.findings.length - 40} more (--json for all)`);
    if (argv.includes('--sheet')) {
      const out = resolve(argv[argv.indexOf('--sheet') + 1]);
      writeFileSync(codes.length > 1 ? out.replace(/(\.\w+)?$/, `.${code}$1`) : out, sheet(r));
      console.log(`    review sheet: ${r.rows.length} row(s) → ${out}`);
    }
    if (r.findings.length && worst === 0) worst = 1;
  }
  return worst;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
