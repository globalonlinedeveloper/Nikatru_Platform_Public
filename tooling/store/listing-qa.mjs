#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// listing-qa.mjs — the translation-QA pass for STORE LISTING text, and the one
// way a drafted listing becomes a store/<channel>/<code>/ folder. [lane aso-listings]
//
// tooling/i18n/translation-qa.mjs is the pipeline's harness for ARB and e-mail
// copy; this applies the same checks (its compareMessage: placeholders, ICU) and
// writes the same review-sheet columns for the listing drafts in
// apps/<app>/aso/pending/<code>.json, adding what only a listing has: the store's
// sourced length limits. The harness itself is not changed (lane i18n-pipeline
// owns it).
//
// The sheet's two halves are two lanes, as translation-qa's are: the drafting
// lane fills translation + back_translation + filled_by; an INDEPENDENT pass (a
// second model run, or a native reader) fills checked_by + verdict. Until every
// row passes, the locale stays pending: --promote refuses, and
// assert-store-listings.mjs limb R fails any locale folder without a passing sheet.
//
// Usage:
//   node tooling/store/listing-qa.mjs <code> [--app <id>]            report
//   node tooling/store/listing-qa.mjs <code> [--app <id>] --sheet    (re)write aso/review/<code>.tsv,
//                                                                     keeping a checker's columns on
//                                                                     rows whose translation is unchanged
//   node tooling/store/listing-qa.mjs <code> [--app <id>] --promote  write store/<channel>/<code>/*
//                                                                     from the draft; only on a passing sheet
// Exit 0 clean (identical-to-English is information) · 1 findings · 2 COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compareMessage } from '../i18n/translation-qa.mjs';
import { DEFAULT_ROOT, SHEET_HEAD, readSheet, registerLocales } from './listing-locales.mjs';

const tsv = (s) => String(s).replace(/\t/g, ' ').replace(/\r?\n/g, '\\n');
const chars = (s) => [...String(s).replace(/\n+$/, '')].length;
const bytes = (s) => Buffer.byteLength(String(s).replace(/\n+$/, ''), 'utf8');
// Read once; ONLY a missing file is null, every other error is rethrown (no exists-then-read race).
const readOrNull = (abs) => {
  try {
    return readFileSync(abs, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
};

/** The rows of a listing review: one per drafted field, with its flags. */
export function listingQa(root, app, code) {
  const { sourceLocale, rows: regRows } = registerLocales(root);
  const row = regRows.find((r) => r.code === code);
  if (!row) return { coverage: `"${code}" is not a row of tooling/i18n/locales.json.` };
  if (code === sourceLocale) return { coverage: `"${code}" is the source locale; there is nothing to translate into it.` };
  const draftRel = `apps/${app}/aso/pending/${code}.json`;
  const draftText = readOrNull(join(root, draftRel));
  if (draftText === null) return { coverage: `${draftRel} does not exist; there is no draft to check.` };
  const draft = JSON.parse(draftText);
  const per = JSON.parse(readFileSync(join(root, 'tooling/channel-register.json'), 'utf8')).storeMetadataContract.perChannel;
  const rows = [];
  const findings = [];
  for (const [key, v] of Object.entries(draft.fields ?? {})) {
    const [channel, file] = key.split('/');
    const enRel = `apps/${app}/store/${channel}/${file}`;
    const en = readOrNull(join(root, enRel))?.replace(/\n+$/, '') ?? null;
    const tr = String(v?.text ?? '');
    const flags = [];
    if (en === null) flags.push(['source', `${enRel} does not exist, so this field has no English to be a translation of`]);
    else {
      flags.push(...compareMessage(en, tr, row.plural));
      if (tr === en) flags.push(['identical', 'same as English']);
    }
    if (tr.trim() === '') flags.push(['missing', 'no translation']);
    if (typeof v?.back !== 'string' || v.back.trim() === '') flags.push(['back', 'no back-translation']);
    const mc = per[channel]?.maxChars?.[file];
    if (mc?.source && Number.isInteger(mc.max) && chars(tr) > mc.max) flags.push(['length', `${chars(tr)} characters, limit ${mc.max}`]);
    const mb = per[channel]?.maxBytes?.[file];
    if (mb?.source && Number.isInteger(mb.max) && bytes(tr) > mb.max) flags.push(['length', `${bytes(tr)} bytes, limit ${mb.max}`]);
    for (const [kind, why] of flags) if (kind !== 'identical') findings.push({ key, kind, why });
    rows.push({ surface: `apps/${app}/store/${channel}/${code}/${file}`, key, en: en ?? '', tr, back: v?.back ?? '', flags: flags.map(([k, w]) => `${k}: ${w}`).join('; '), filledBy: draft.filledBy ?? '' });
  }
  if (rows.length === 0) return { coverage: `${draftRel} has no fields.` };
  return { coverage: null, draft, draftRel, rows, findings };
}

/** The sheet text; a checker's columns survive on rows whose translation did not change. */
export function sheetText(result, previous = null) {
  const keep = new Map((previous?.rows ?? []).map((r) => [r.key, r]));
  const lines = [SHEET_HEAD.join('\t')];
  for (const r of result.rows) {
    const old = keep.get(r.key);
    const same = old && old.translation === tsv(r.tr);
    lines.push([r.surface, r.key, r.en, r.tr, r.back, r.flags, r.filledBy, same ? old.checked_by : '', same ? old.verdict : ''].map(tsv).join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && process.argv[1].endsWith('listing-qa.mjs')) {
  const argv = process.argv.slice(2);
  const code = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--app');
  const app = argv.includes('--app') ? argv[argv.indexOf('--app') + 1] : 'subscriptiontracker';
  if (!code) {
    console.error('usage: listing-qa.mjs <code> [--app <id>] [--sheet | --promote]');
    process.exit(2);
  }
  const r = listingQa(DEFAULT_ROOT, app, code);
  if (r.coverage) {
    console.error(`listing-qa: COVERAGE LOST — ${r.coverage}`);
    process.exit(2);
  }
  const sheetRel = `apps/${app}/aso/review/${code}.tsv`;
  const sheetAbs = join(DEFAULT_ROOT, sheetRel);
  const priorText = readOrNull(sheetAbs);
  const previous = priorText === null ? null : readSheet(priorText);
  console.log(`listing-qa: ${app} ${code} — ${r.rows.length} field(s) drafted in ${r.draftRel}, ${r.findings.length} finding(s)`);
  for (const f of r.findings) console.log(`  ✗ ${f.key}: ${f.kind} — ${f.why}`);
  if (argv.includes('--sheet')) {
    mkdirSync(dirname(sheetAbs), { recursive: true });
    writeFileSync(sheetAbs, sheetText(r, previous));
    console.log(`  review sheet: ${r.rows.length} row(s) → ${sheetRel} (checked_by and verdict are the independent pass's to fill)`);
  }
  if (argv.includes('--promote')) {
    if (!previous?.passing) {
      console.error(`listing-qa: REFUSING --promote — ${sheetRel} does not pass: ${previous ? previous.why : 'it does not exist'}.`);
      process.exit(1);
    }
    for (const row of r.rows) {
      const abs = join(DEFAULT_ROOT, row.surface);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, `${row.tr.replace(/\n+$/, '')}\n`);
      console.log(`  wrote ${row.surface}`);
    }
    console.log(`  NEXT, in the same commit: delete the ${code} exemptions in apps/${app}/store/listing-locales.json and ${r.draftRel}.`);
  }
  process.exit(r.findings.length ? 1 : 0);
}
