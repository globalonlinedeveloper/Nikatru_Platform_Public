#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// translation-qa.mjs — the translation QA harness. No API call, no network:
// it reads ARB files and the locale register, and it writes a review sheet.
//
// Given a locale it reports, for every ARB set of the factory (each app's
// lib/l10n, the chassis, the brick):
//   missing      a key the English template has and the locale does not
//   extra        a key the locale has and the template does not
//   changed      (with --since <git-ref>) a key whose ENGLISH value changed
//                since <ref> while the translation did not — it translates a
//                sentence that no longer exists
//   placeholder  a {placeholder} the English uses and the translation drops, or
//                one the translation invents (ICU-aware: a select arm body is not
//                mistaken for a placeholder)
//   icu          a plural/select argument whose TYPE differs from the English, a
//                select whose arms differ, or a plural with a category the
//                locale's CLDR rules (the register's `pluralRules`) do not use or
//                without `other`
//
// and it writes a REVIEW SHEET: one row per message with the source, the
// translation, the translator note, and empty slots for a back-translation, a
// verdict and a second-lane check. The two-lane protocol:
//
//   lane A  node tooling/i18n/translation-qa.mjs --locale hi --sheet hi.review.json
//           fills `backTranslation` (English, from the translation alone) and
//           `verdict` (ok | fix: <reason>) on every row, and `filledBy`.
//   lane B  fills `checkedBy` and `check` (agree | disagree: <reason>) per row.
//   either  node tooling/i18n/translation-qa.mjs --check-sheet hi.review.json
//           refuses a row with an empty slot, a lane that checked its own rows,
//           and a row whose source or translation no longer matches the ARB.
//
// Usage:
//   node tooling/i18n/translation-qa.mjs --locale <code> [--set app|chassis|brick] [--since <ref>] [--sheet <out.json>] [--json]
//   node tooling/i18n/translation-qa.mjs --all                    every supported non-source locale
//   node tooling/i18n/translation-qa.mjs --check-sheet <sheet.json>
//
// Exit 0 = clean. 1 = a finding (or a sheet that is not complete). 2 = COVERAGE
// LOST: the locale has no ARB in any set, or no set was found at all.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listDir } from '../ci/tree-walk.mjs';
import { DEFAULT_ROOT, loadRegister, supportedCodes } from './locales.mjs';

const SELECTORS = new Set(['plural', 'select', 'selectordinal']);

/** One ICU message parsed into its placeholders and its selector arguments.
 *  `args` maps an argument name to `{type, arms}` for plural/select/selectordinal. */
export function parseIcu(value) {
  const s = String(value);
  const placeholders = new Set();
  const args = new Map();
  let i = 0;
  const space = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const token = () => {
    const start = i;
    while (i < s.length && !', {}\t\n\r'.includes(s[i])) i++;
    return s.slice(start, i);
  };
  const skipToClose = () => {
    let depth = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '}' && depth === 0) return;
      if (c === '{') depth++;
      if (c === '}') depth--;
      i++;
    }
  };
  const message = () => {
    while (i < s.length) {
      const c = s[i];
      if (c === '}') return;
      i++;
      if (c === '{') argument();
    }
  };
  const arms = (name, type) => {
    const seen = [];
    while (i < s.length) {
      space();
      if (i >= s.length || s[i] === '}') break;
      const selector = token();
      space();
      if (s[i] === '{') {
        i++;
        message();
        if (s[i] === '}') i++;
        if (selector) seen.push(selector);
      } else if (!selector) i++;
    }
    const prior = args.get(name);
    args.set(name, { type, arms: [...new Set([...(prior?.arms ?? []), ...seen])].sort() });
  };
  const argument = () => {
    space();
    const name = token();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) placeholders.add(name);
    space();
    if (s[i] === ',') {
      i++;
      space();
      const type = token();
      space();
      if (SELECTORS.has(type)) {
        if (s[i] === ',') i++;
        arms(name, type);
      } else skipToClose();
    }
    if (s[i] === '}') i++;
  };
  message();
  return { placeholders, args };
}

const PLURAL_ARM = /^(zero|one|two|few|many|other|=\d+)$/;

/** Every placeholder and ICU problem of [translation] against [source]. Pure. */
export function messageProblems(source, translation, pluralRules) {
  const out = [];
  // A mason tag ({{{name}}}) is template text, not ICU.
  if (/\{\{/.test(source) || /\{\{/.test(translation)) return out;
  const en = parseIcu(source);
  const tr = parseIcu(translation);
  const dropped = [...en.placeholders].filter((p) => !tr.placeholders.has(p));
  const invented = [...tr.placeholders].filter((p) => !en.placeholders.has(p));
  if (dropped.length) out.push({ kind: 'placeholder', detail: `drops {${dropped.join('}, {')}}` });
  if (invented.length) out.push({ kind: 'placeholder', detail: `invents {${invented.join('}, {')}}` });
  for (const [name, a] of en.args) {
    const b = tr.args.get(name);
    if (!b) {
      if (tr.placeholders.has(name)) out.push({ kind: 'icu', detail: `{${name}} is a ${a.type} in English and plain text here` });
      continue;
    }
    if (a.type !== b.type) {
      out.push({ kind: 'icu', detail: `{${name}} is a ${a.type} in English and a ${b.type} here` });
      continue;
    }
    if (a.type === 'select' && a.arms.join(',') !== b.arms.join(',')) {
      out.push({ kind: 'icu', detail: `{${name}, select} arms are [${b.arms.join(', ')}], English has [${a.arms.join(', ')}]` });
    }
    if (a.type === 'plural') {
      if (!b.arms.includes('other')) out.push({ kind: 'icu', detail: `{${name}, plural} has no "other" arm` });
      const allowed = new Set(pluralRules);
      const foreign = b.arms.filter((x) => PLURAL_ARM.test(x) && !x.startsWith('=') && !allowed.has(x));
      if (foreign.length) out.push({ kind: 'icu', detail: `{${name}, plural} uses ${foreign.join(', ')}, which this locale's CLDR rules (${pluralRules.join(', ')}) never select` });
    }
  }
  return out;
}

/** The ARB sets of a tree: each app's lib/l10n, the chassis, the brick. */
export function arbSets(root) {
  const sets = [];
  if (existsSync(join(root, 'apps'))) {
    for (const app of listDir(join(root, 'apps')).sort()) {
      const dir = `apps/${app}/lib/l10n`;
      if (existsSync(join(root, dir, 'app_en.arb'))) sets.push({ name: `app:${app}`, kind: 'app', dir, prefix: 'app' });
    }
  }
  const chassis = 'packages/design_system/lib/src/l10n';
  if (existsSync(join(root, chassis, 'chassis_en.arb'))) sets.push({ name: 'chassis', kind: 'chassis', dir: chassis, prefix: 'chassis' });
  const brick = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/l10n';
  if (existsSync(join(root, brick, 'app_en.arb'))) sets.push({ name: 'brick', kind: 'brick', dir: brick, prefix: 'app' });
  return sets;
}

const messages = (arb) => Object.keys(arb).filter((k) => !k.startsWith('@'));

function readAt(root, ref, rel) {
  const r = spawnSync('git', ['-C', root, 'show', `${ref}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
}

/** The QA report for one locale across [sets]. */
export function qaLocale(root, reg, locale, { sets = arbSets(root), since = null } = {}) {
  const row = reg.locales.find((r) => r.code === locale);
  const pluralRules = (row?.pluralRules ?? 'one,other').split(',');
  const findings = [];
  const sheet = [];
  let covered = 0;
  for (const set of sets) {
    const enRel = `${set.dir}/${set.prefix}_${reg.source}.arb`;
    const trRel = `${set.dir}/${set.prefix}_${locale}.arb`;
    if (!existsSync(join(root, trRel))) {
      findings.push({ set: set.name, key: '*', kind: 'missing', detail: `${trRel} does not exist — every message renders in the source language` });
      continue;
    }
    covered++;
    const en = JSON.parse(readFileSync(join(root, enRel), 'utf8'));
    const tr = JSON.parse(readFileSync(join(root, trRel), 'utf8'));
    const enKeys = messages(en);
    const trKeys = new Set(messages(tr));
    const oldEn = since ? readAt(root, since, enRel) : null;
    const oldTr = since ? readAt(root, since, trRel) : null;
    for (const k of enKeys) {
      if (!trKeys.has(k)) {
        findings.push({ set: set.name, key: k, kind: 'missing', detail: 'no translation' });
        continue;
      }
      for (const p of messageProblems(en[k], tr[k], pluralRules)) findings.push({ set: set.name, key: k, ...p });
      if (oldEn && k in oldEn && oldEn[k] !== en[k] && oldTr && oldTr[k] === tr[k]) {
        findings.push({ set: set.name, key: k, kind: 'changed', detail: `the English changed since ${since} and the translation did not` });
      }
      sheet.push({
        set: set.name,
        key: k,
        note: en[`@${k}`]?.description ?? '',
        source: en[k],
        translation: tr[k],
        backTranslation: '',
        verdict: '',
        filledBy: '',
        check: '',
        checkedBy: '',
      });
    }
    for (const k of trKeys) if (!(k in en)) findings.push({ set: set.name, key: k, kind: 'extra', detail: 'not in the English template' });
  }
  return { locale, covered, findings, sheet };
}

/** Every reason a filled review sheet is not complete, against the current tree. */
export function sheetProblems(root, sheet) {
  const out = [];
  if (!Array.isArray(sheet?.rows) || sheet.rows.length === 0) return ['the sheet has no rows'];
  const sets = new Map(arbSets(root).map((s) => [s.name, s]));
  const cache = new Map();
  const arb = (rel) => {
    if (!cache.has(rel)) cache.set(rel, existsSync(join(root, rel)) ? JSON.parse(readFileSync(join(root, rel), 'utf8')) : null);
    return cache.get(rel);
  };
  for (const [n, r] of sheet.rows.entries()) {
    const at = `row ${n + 1} (${r.set} ${r.key})`;
    for (const slot of ['backTranslation', 'verdict', 'filledBy', 'check', 'checkedBy']) {
      if (typeof r[slot] !== 'string' || r[slot].trim() === '') out.push(`${at}: \`${slot}\` is empty`);
    }
    if (r.filledBy && r.checkedBy && r.filledBy.trim() === r.checkedBy.trim()) out.push(`${at}: checked by the lane that filled it (${r.filledBy}) — the check must be a second lane`);
    if (r.verdict && !/^(ok|fix: .+)$/.test(r.verdict)) out.push(`${at}: verdict "${r.verdict}" is not "ok" or "fix: <reason>"`);
    if (r.check && !/^(agree|disagree: .+)$/.test(r.check)) out.push(`${at}: check "${r.check}" is not "agree" or "disagree: <reason>"`);
    const set = sets.get(r.set);
    if (!set) {
      out.push(`${at}: no ARB set named ${r.set}`);
      continue;
    }
    const en = arb(`${set.dir}/${set.prefix}_en.arb`);
    const tr = arb(`${set.dir}/${set.prefix}_${sheet.locale}.arb`);
    if (en?.[r.key] !== r.source) out.push(`${at}: the English is no longer what the sheet reviewed — regenerate the sheet`);
    if (tr?.[r.key] !== r.translation) out.push(`${at}: the translation is no longer what the sheet reviewed — regenerate the sheet`);
  }
  return out;
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const root = resolve(opt('--root') ?? DEFAULT_ROOT);
  const reg = loadRegister(root);

  const checkSheet = opt('--check-sheet');
  if (checkSheet) {
    const sheet = JSON.parse(readFileSync(checkSheet, 'utf8'));
    const problems = sheetProblems(root, sheet);
    if (problems.length) {
      console.error(`✗ review sheet ${checkSheet} — ${problems.length} problem(s):`);
      for (const p of problems.slice(0, 200)) console.error(`    ${p}`);
      if (problems.length > 200) console.error(`    … and ${problems.length - 200} more`);
      return 1;
    }
    console.log(`ok  review sheet ${checkSheet} — ${sheet.rows.length} row(s) filled, back-translated and checked by a second lane`);
    return 0;
  }

  const locales = argv.includes('--all') ? supportedCodes(reg).filter((c) => c !== reg.source) : [opt('--locale')].filter(Boolean);
  if (locales.length === 0) {
    console.error('usage: translation-qa.mjs --locale <code> [--set app|chassis|brick] [--since <ref>] [--sheet <out.json>] [--json] | --all | --check-sheet <file>');
    return 1;
  }
  const kind = opt('--set');
  const sets = arbSets(root).filter((s) => !kind || s.kind === kind);
  if (sets.length === 0) {
    console.error(`✗ COVERAGE LOST — no ARB set${kind ? ` of kind ${kind}` : ''} found under ${root}`);
    return 2;
  }
  let worst = 0;
  const reports = [];
  for (const locale of locales) {
    const rep = qaLocale(root, reg, locale, { sets, since: opt('--since') });
    reports.push(rep);
    if (rep.covered === 0) {
      console.error(`✗ COVERAGE LOST — ${locale}: no ARB file in any of ${sets.length} set(s), so nothing was compared`);
      worst = 2;
      continue;
    }
    const sheetOut = opt('--sheet');
    if (sheetOut && locales.length === 1) {
      writeFileSync(sheetOut, `${JSON.stringify({ locale, generatedFrom: sets.map((s) => s.dir), rows: rep.sheet }, null, 2)}\n`);
      console.log(`wrote ${sheetOut} — ${rep.sheet.length} row(s) to back-translate and check`);
    }
    if (!argv.includes('--json')) {
      const by = (k) => rep.findings.filter((f) => f.kind === k).length;
      const line = `${locale}: ${rep.sheet.length} message(s) in ${rep.covered} set(s) · missing ${by('missing')} · extra ${by('extra')} · changed ${by('changed')} · placeholder ${by('placeholder')} · icu ${by('icu')}`;
      if (rep.findings.length) {
        console.error(`✗ ${line}`);
        for (const f of rep.findings.slice(0, 200)) console.error(`    [${f.kind}] ${f.set} ${f.key}: ${f.detail}`);
        if (rep.findings.length > 200) console.error(`    … and ${rep.findings.length - 200} more`);
      } else console.log(`ok  ${line}`);
    }
    if (rep.findings.length && worst === 0) worst = 1;
  }
  if (argv.includes('--json')) console.log(JSON.stringify(reports.map(({ sheet, ...r }) => ({ ...r, messages: sheet.length })), null, 2));
  return worst;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
